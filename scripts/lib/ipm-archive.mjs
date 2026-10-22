// Pure helpers of the IPM archive proof (Story 42.4; `scripts/ci-ipm-archive.mjs`). Importing this module runs nothing and
// spawns nothing: staging writes only under the directory it is given, and every other function maps text to text.
//
// The proof builds the module archive from the generated embed (`BOOTSTRAP_CLASSES`, `IPM_INSTALL_GUARD` of
// `@iris-mcp/shared`), never from `src/` (AD-14), and installs it on throwaway IRIS containers that have no network. The helpers
// here stage the module, read the manifest a module declares, compare the archive with the embed, build the terminal-session
// scripts the proof pipes into `iris session`, and read their markers back.
//
// SESSION SCRIPTS. `iris session` echoes its own input, so every marker literal is written split (`"IRISMCP-"_"X-START:"`) and
// the echo of the command never matches the marker it prints. A session executes each piped line as one command, so every
// statement here is one line.
//
// IPM VERBS. The scripts issue exactly the verbs in {@link IPM_VERBS} and no other: `load` (a staged directory with `-dev`, or the
// archive), `package` and `list`. None of them uploads anything: `package` writes a local archive. There is no `install`, `update`,
// `publish`, `repo` or `enable` anywhere in this file (AC 42.4.4); `ci-ipm-archive.test.ts` holds that set equal to the verbs of
// the scripts a full run feeds to the sessions.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { CONTAINER_WEB_PORT, THROWAWAY_PASSWORD, THROWAWAY_USERNAME } from '../throwaway-iris.mjs';

/** The IPM verbs the proof issues, in both directions of the comparison with the scripts. */
export const IPM_VERBS = Object.freeze(['load', 'package', 'list']);

/** The IPM verbs the proof must never issue: each one reaches a registry or changes what is enabled. */
export const FORBIDDEN_IPM_VERBS = Object.freeze(['publish', 'install', 'repo', 'enable', 'update']);

/** The offline copy of IPM every IRIS image carries, and where the proof's directories sit inside a container. */
export const IPM_IMPORT_FILE = '/usr/irissys/dist/install/misc/zpm.xml';
export const STAGE_MOUNT = '/opt/iris-mcp/stage';
export const INSTALL_MOUNT = '/opt/iris-mcp/install';
export const OUTPUT_DIRECTORY = '/tmp/iris-mcp-ipm-out';

/** The web application the module's `Configure` registers, and a route that answers without a request body. */
export const REST_APP = '/api/executemcp/v2';
export const REST_PROBE_ROUTE = `${REST_APP}/config/namespace`;

/**
 * The Atelier routes the server's bootstrap reads to learn who owns the classes (the install guard's document answers 200 when IPM
 * installed them, and a document that does not exist answers 404), at the lowest API version every IRIS serves. The namespace is the
 * session's, appended by the script that makes the request.
 */
export const GUARD_DOCUMENT_ROUTE = '/api/atelier/v1/';
export const GUARD_DOCUMENT = 'ExecuteMCPv2.InstallGuard.cls';
export const ABSENT_DOCUMENT = 'ExecuteMCPv2.NoSuchGuard.cls';

/** The words the install guard's refusal carries (`ipm/preload/ExecuteMCPv2/InstallGuard.cls`). */
export const GUARD_REFUSAL_TEXT = 'ExecuteMCPv2.InstallGuard refused the install';

/** The line that holds the stamped marker in a class (`Parameter BOOTSTRAPVERSION = "...";`), and the placeholder on disk. */
const MARKER_LINE_PATTERN = /^Parameter BOOTSTRAPVERSION = "([^"]*)";$/m;
const PLACEHOLDER_LINE = 'Parameter BOOTSTRAPVERSION = "dev";';

// -- The embed ---------------------------------------------------------------------------

/**
 * The embed of the BUILT shared dist plus the checked-in manifest: everything the proof stages and compares.
 *
 * @param {string} repoRoot
 * @returns {Promise<{ marker: string, classes: ReadonlyMap<string, string>, guard: { name: string, content: string }, moduleName: string, moduleXml: string, classify: (deployed: string, embedded: string) => string, parse: (marker: string) => unknown }>}
 */
export async function loadEmbed(repoRoot) {
  const dist = (file) => path.join(repoRoot, 'packages', 'shared', 'dist', file);
  let classes;
  let version;
  try {
    classes = await import(pathToFileURL(dist('bootstrap-classes.js')).href);
    version = await import(pathToFileURL(dist('bootstrap-version.js')).href);
  } catch (error) {
    throw new Error(
      `the shared dist is not built (${error instanceof Error ? error.message : String(error)}): run pnpm --filter @iris-mcp/shared build.`,
    );
  }
  for (const name of ['BOOTSTRAP_VERSION', 'BOOTSTRAP_CLASSES', 'IPM_INSTALL_GUARD', 'IPM_MODULE_NAME']) {
    if (classes[name] === undefined) throw new Error(`packages/shared/dist/bootstrap-classes.js exports no ${name}: rebuild the shared package after pnpm gen:bootstrap.`);
  }
  return {
    marker: classes.BOOTSTRAP_VERSION,
    classes: classes.BOOTSTRAP_CLASSES,
    guard: classes.IPM_INSTALL_GUARD,
    moduleName: classes.IPM_MODULE_NAME,
    moduleXml: readFileSync(path.join(repoRoot, 'ipm', 'module.xml'), 'utf8'),
    classify: version.classifyDeployedMarker,
    parse: version.parseBootstrapMarker,
  };
}

/** The semver of a marker `<semver>+<sequence>.<hash>`. */
export function markerSemver(marker) {
  return String(marker).split('+')[0];
}

/** `ExecuteMCPv2.REST.Base.cls` as the path segments `['ExecuteMCPv2', 'REST', 'Base.cls']`. */
export function classPathSegments(documentName) {
  const stem = String(documentName).replace(/\.cls$/, '');
  return [...stem.split('.').slice(0, -1), `${stem.split('.').at(-1)}.cls`];
}

/** The line ends the embed and the archive are compared after: LF, with no trailing whitespace. */
export function normalizeText(text) {
  return String(text).replace(/\r\n/g, '\n').trimEnd();
}

/** The marker a class text stamps, or `undefined` when it has no `Parameter BOOTSTRAPVERSION` line. */
function stampedMarker(content) {
  return MARKER_LINE_PATTERN.exec(content)?.[1];
}

/**
 * What is wrong with an embed that is about to be staged: an empty list means every class and the guard carry the embed's
 * marker, no content still holds the `dev` placeholder, no test or fixture class is among the classes, and the manifest names
 * the embed's module at the embed's semver.
 */
export function embedProblems(embed) {
  const problems = [];
  if (!(embed.classes instanceof Map) || embed.classes.size === 0) problems.push('the embed holds no classes.');
  const documents = [...(embed.classes instanceof Map ? embed.classes : new Map()).entries(), [embed.guard?.name, embed.guard?.content]];
  for (const [name, content] of documents) {
    if (typeof content !== 'string') {
      problems.push(`${name}: the embed holds no content.`);
      continue;
    }
    if (content.includes(PLACEHOLDER_LINE)) {
      problems.push(`${name} still holds the dev placeholder (${PLACEHOLDER_LINE}): it was not stamped by pnpm gen:bootstrap.`);
    }
    if (/\.Tests\.|QAFixtures/.test(name)) problems.push(`${name} is a test or fixture class: the archive never carries one.`);
  }
  for (const name of ['ExecuteMCPv2.Setup.cls', embed.guard?.name]) {
    const content = name === embed.guard?.name ? embed.guard?.content : embed.classes?.get(name);
    const marker = typeof content === 'string' ? stampedMarker(content) : undefined;
    if (marker !== embed.marker) {
      problems.push(`${name} stamps the marker ${JSON.stringify(marker)}, not the embed's BOOTSTRAP_VERSION ${JSON.stringify(embed.marker)}.`);
    }
  }
  const declared = manifestDeclarations(embed.moduleXml ?? '');
  if (declared.name !== embed.moduleName) problems.push(`ipm/module.xml names the module ${JSON.stringify(declared.name)}, not ${JSON.stringify(embed.moduleName)}.`);
  if (declared.version !== markerSemver(embed.marker)) {
    problems.push(`ipm/module.xml is at version ${JSON.stringify(declared.version)}, not the embed's ${JSON.stringify(markerSemver(embed.marker))}: run pnpm gen:bootstrap.`);
  }
  return problems;
}

/**
 * Stage the module under `dir`: `module.xml`, one `src/cls/<package path>.cls` per embedded class, and the preloaded guard at
 * `preload/src/cls/ExecuteMCPv2/InstallGuard.cls`. Every directory is 0755 and every file 0644 (`a+rX`), so the IRIS user inside a
 * container can read what a read-only mount shows it. It refuses, and writes nothing, when {@link embedProblems} finds anything.
 *
 * @param {string} dir - An existing, empty directory.
 * @param {Awaited<ReturnType<typeof loadEmbed>>} embed
 * @returns {{ files: string[] }} The files written, relative to `dir`.
 */
export function stageModule(dir, embed) {
  const problems = embedProblems(embed);
  if (problems.length > 0) throw new Error(`refusing to stage the module: ${problems.join(' ')}`);
  const files = [];
  const write = (relative, text) => {
    const file = path.join(dir, relative);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
    writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    chmodSync(file, 0o644);
    files.push(relative);
  };
  write('module.xml', embed.moduleXml);
  for (const [name, content] of embed.classes) write(path.join('src', 'cls', ...classPathSegments(name)), content);
  write(path.join('preload', 'src', 'cls', ...classPathSegments(embed.guard.name)), embed.guard.content);
  for (const directory of new Set(files.flatMap((file) => directoriesOf(file)))) chmodSync(path.join(dir, directory), 0o755);
  chmodSync(dir, 0o755);
  return { files };
}

/** Every directory above `file` (relative), outermost first. */
function directoriesOf(file) {
  const parts = file.split(path.sep).slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join(path.sep));
}

// -- The manifest -----------------------------------------------------------------------

/** Every `name="value"` attribute of one element tag, by name. */
function attributesOf(tag) {
  return Object.fromEntries([...tag.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

/** The text of the first `<Tag>text</Tag>` of an XML text, or `undefined`. */
function elementText(xml, tag) {
  return new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1]?.trim();
}

/**
 * What a module manifest declares, read as text: the module name, version and sources root, each `<Resource>`'s name and `Preload`
 * flag, and each `<Invoke>`'s class, method, phase, moment and `CheckStatus`. IPM re-serializes a manifest on export (attribute order,
 * defaults, the default `<Packaging>`), so the comparison is over declarations and never over bytes. An absent `Phase` is `Configure`,
 * an absent `When` is `After`, an absent `Preload` is `false`, and an absent `CheckStatus` is `undefined` (`true` or `1` is `true`).
 *
 * @param {string} xml
 * @returns {{ name?: string, version?: string, sourcesRoot?: string, resources: Array<{ name: string, preload: boolean }>, invokes: Array<{ class: string, method: string, phase: string, when: string, checkStatus?: boolean }> }}
 */
export function manifestDeclarations(xml) {
  const text = String(xml).replace(/<!--[\s\S]*?-->/g, '');
  const tags = (element) => [...text.matchAll(new RegExp(`<${element}(\\s[^>]*)?/?>`, 'g'))].map((match) => attributesOf(match[0]));
  return {
    name: elementText(text, 'Name'),
    version: elementText(text, 'Version'),
    sourcesRoot: elementText(text, 'SourcesRoot'),
    resources: tags('Resource').map((attributes) => ({ name: attributes.Name, preload: attributes.Preload === 'true' })),
    invokes: tags('Invoke').map((attributes) => ({
      class: attributes.Class,
      method: attributes.Method,
      phase: attributes.Phase ?? 'Configure',
      when: attributes.When ?? 'After',
      checkStatus: attributes.CheckStatus === undefined ? undefined : /^(true|1)$/i.test(attributes.CheckStatus),
    })),
  };
}

/**
 * What differs between the manifest the repository declares and the one the archive carries. Resources compare as sets (IPM may
 * order them as it likes); invokes compare in order, because `Check` must run before `Configure`. An invoke the repository declares
 * with `CheckStatus` must carry it in the archive too: IPM 0.10.0 to 0.10.4 act on a returned `%Status` only then, so without it the
 * install guard's refusal is ignored there (IPM may write the attribute on other invokes, which is not a problem). Fewer declarations
 * than the repository manifest holds is a problem of its own: a comparison that read less than the file holds passes having compared
 * nothing.
 *
 * @param {ReturnType<typeof manifestDeclarations>} declared
 * @param {ReturnType<typeof manifestDeclarations>} archived
 * @returns {string[]}
 */
export function manifestProblems(declared, archived) {
  const problems = [];
  if (declared.resources.length === 0 || declared.invokes.length === 0 || declared.name === undefined || declared.version === undefined) {
    problems.push('the repository manifest declares too little to compare (it needs a name, a version, resources and invokes).');
  }
  for (const field of ['name', 'version', 'sourcesRoot']) {
    if (declared[field] !== archived[field]) problems.push(`${field}: the repository declares ${JSON.stringify(declared[field])}, the archive ${JSON.stringify(archived[field])}.`);
  }
  const key = (resource) => `${resource.name}${resource.preload ? ' (preload)' : ''}`;
  const have = new Set(archived.resources.map(key));
  const want = new Set(declared.resources.map(key));
  for (const resource of want) if (!have.has(resource)) problems.push(`resource ${resource} is declared but not in the archive's manifest.`);
  for (const resource of have) if (!want.has(resource)) problems.push(`resource ${resource} is in the archive's manifest but not declared.`);
  const invoke = (entry) => `${entry.class}.${entry.method} ${entry.phase}/${entry.when}`;
  const wantInvokes = declared.invokes.map(invoke);
  const haveInvokes = archived.invokes.map(invoke);
  if (JSON.stringify(wantInvokes) !== JSON.stringify(haveInvokes)) {
    problems.push(`invokes: the repository declares [${wantInvokes.join(', ')}], the archive [${haveInvokes.join(', ')}].`);
  }
  declared.invokes.forEach((entry, index) => {
    if (entry.checkStatus === true && archived.invokes[index]?.checkStatus !== true) {
      problems.push(`invoke ${invoke(entry)}: the repository sets CheckStatus, the archive's manifest does not, so IPM 0.10.0 to 0.10.4 would ignore the status it returns.`);
    }
  });
  return problems;
}

// -- The archive ------------------------------------------------------------------------

/**
 * What is wrong with an archive, given its member list (as `tar tzf` lists it) and the directory it was extracted to: it must carry
 * `module.xml`, one `src/cls/<path>.cls` member per embedded class and no other under `src/cls/`, the preloaded guard, and no test
 * or fixture member; and every class member must equal the embed after LF and trailing-whitespace normalization. A repeated slash
 * in a member name (IPM joins `src/` and `cls` with a doubled one) is collapsed first.
 *
 * @param {readonly string[]} members
 * @param {string} extractedDir
 * @param {Awaited<ReturnType<typeof loadEmbed>>} embed
 * @param {{ read?: (file: string) => string }} [options]
 * @returns {string[]}
 */
export function archiveProblems(members, extractedDir, embed, options = {}) {
  const read = options.read ?? ((file) => readFileSync(file, 'utf8'));
  const problems = [];
  const names = members.map((member) => member.replace(/\/\/+/g, '/').replace(/^\.\//, '')).filter((member) => member !== '' && !member.endsWith('/'));
  const present = new Set(names);

  if (!present.has('module.xml')) problems.push('the archive carries no module.xml, so nothing can install it.');
  const expected = new Map();
  for (const [name, content] of embed.classes) expected.set(['src', 'cls', ...classPathSegments(name)].join('/'), content);
  expected.set(['preload', 'src', 'cls', ...classPathSegments(embed.guard.name)].join('/'), embed.guard.content);

  const classMembers = names.filter((member) => /^src\/cls\/.*\.cls$/.test(member));
  if (classMembers.length !== embed.classes.size) {
    problems.push(`the archive carries ${classMembers.length} src/cls class member(s), the embed ${embed.classes.size}.`);
  }
  for (const [member, content] of expected) {
    if (!present.has(member)) {
      problems.push(`the archive is missing ${member}.`);
      continue;
    }
    let onDisk;
    try {
      onDisk = read(path.join(extractedDir, ...member.split('/')));
    } catch (error) {
      problems.push(`${member} could not be read from the extracted archive (${error instanceof Error ? error.message : String(error)}).`);
      continue;
    }
    if (normalizeText(onDisk) !== normalizeText(content)) problems.push(`${member} differs from the embed.`);
  }
  for (const member of classMembers) if (!expected.has(member)) problems.push(`the archive carries ${member}, which is not an embedded class.`);
  for (const member of names) {
    if (/\/Tests\/|QAFixtures/.test(member)) problems.push(`the archive carries the test or fixture member ${member}.`);
  }
  if (!names.some((member) => member.startsWith('preload/'))) problems.push('the archive carries no preload member: the guard would not run.');
  return problems;
}

// -- Session scripts --------------------------------------------------------------------

/** `Write "IRISMCP-"_"NAME-START:"_(<expression>)_":IRISMCP-"_"NAME-END",!`: one marker line, split so the session's echo never matches. */
export function markerStatement(name, expression) {
  if (!/^[A-Z0-9-]+$/.test(name)) throw new Error(`a marker name is upper-case letters, digits and "-": ${JSON.stringify(name)}`);
  return `Write "IRISMCP-"_"${name}-START:"_(${expression})_":IRISMCP-"_"${name}-END",!`;
}

/** The value of the marker `name` in a session's output, or `undefined`. The first complete marker wins. */
export function markerValue(output, name) {
  if (!/^[A-Z0-9-]+$/.test(name)) throw new Error(`a marker name is upper-case letters, digits and "-": ${JSON.stringify(name)}`);
  const match = new RegExp(`IRISMCP-${name}-START:([\\s\\S]*?):IRISMCP-${name}-END`).exec(String(output));
  return match?.[1];
}

/** A script from its statements: one per line, then `Halt`. */
export function sessionScript(statements) {
  for (const statement of statements) {
    if (/[\r\n]/.test(statement)) throw new Error(`a session statement is one line: ${JSON.stringify(statement)}`);
  }
  return `${statements.join('\n')}\nHalt\n`;
}

/** `$Select(IsOK(tSC):"OK",1:"FAILED:"_message)`: the outcome text of a status held in `tSC`. */
const STATUS_OUTCOME = '$Select($System.Status.IsOK(tSC):"OK",1:"FAILED:"_$System.Status.GetErrorText(tSC))';

/** The statement that prints the number of rows of `%IPM_Repo.Definition` (the package registries IPM knows) as the `REPOSITORIES` marker. */
export function repositoriesStatements() {
  return [
    'Set tRS = ##class(%SQL.Statement).%ExecDirect(,"SELECT COUNT(*) FROM %IPM_Repo.Definition")',
    markerStatement('REPOSITORIES', '$Select(tRS.%Next():tRS.%GetData(1),1:"unread")'),
  ];
}

/** Import IPM from the image's offline copy into the session's namespace, then read the repository count. Markers: `IPM`, `REPOSITORIES`. */
export function importIpmScript() {
  return sessionScript([
    `Set tSC = $System.OBJ.Load("${IPM_IMPORT_FILE}","ck")`,
    markerStatement('IPM', STATUS_OUTCOME),
    ...repositoriesStatements(),
  ]);
}

/** Read the repository count only. Marker: `REPOSITORIES`. */
export function repositoriesScript() {
  return sessionScript(repositoriesStatements());
}

/**
 * Run one IPM command, print its outcome as the `COMMAND` marker (`OK`, or `FAILED:` and the status text), then read the repository
 * count. The verb must be one of {@link IPM_VERBS}; the command holds no double quote.
 *
 * @param {string} command - For example `load -dev /opt/iris-mcp/stage`.
 */
export function ipmCommandScript(command) {
  const verb = String(command).split(/\s+/)[0];
  if (!IPM_VERBS.includes(verb)) throw new Error(`refusing the IPM verb ${JSON.stringify(verb)}: the proof issues only ${IPM_VERBS.join(', ')}.`);
  if (/["\r\n]/.test(command)) throw new Error(`an IPM command holds no double quote or line break: ${JSON.stringify(command)}`);
  return sessionScript([
    `Set tSC = ##class(%IPM.Main).Shell("${command}",0,0)`,
    markerStatement('COMMAND', STATUS_OUTCOME),
    ...repositoriesStatements(),
  ]);
}

/** Empty and recreate the directory `package` writes into, so exactly one archive in it identifies the artifact. Marker: `OUTDIR`. */
export function outputDirectoryScript(directory = OUTPUT_DIRECTORY) {
  return sessionScript([
    `Set tDir = "${directory}"`,
    'Do ##class(%File).RemoveDirectoryTree(tDir)',
    'Set tOK = ##class(%File).CreateDirectoryChain(tDir)',
    markerStatement('OUTDIR', 'tOK'),
  ]);
}

/** List the files of the output directory, `|`-separated, as the `FILES` marker. */
export function listOutputScript(directory = OUTPUT_DIRECTORY) {
  return sessionScript([
    'Set tList = ""',
    `Set tRS = ##class(%ResultSet).%New("%File:FileSet") Do tRS.Execute("${directory}","*") For  Quit:'tRS.Next()  Set tList = tList_##class(%File).GetFilename(tRS.Get("Name"))_"|"`,
    markerStatement('FILES', 'tList'),
  ]);
}

/** Load a synthetic `ExecuteMCPv2.Setup` class from a mounted file into the session's namespace. Marker: `SYNTH`. */
export function loadSyntheticSetupScript(file) {
  return sessionScript([`Set tSC = $System.OBJ.Load("${file}","ck")`, markerStatement('SYNTH', STATUS_OUTCOME)]);
}

/** Delete `ExecuteMCPv2.Setup` from the session's namespace. Marker: `DELETE`. */
export function deleteSetupScript() {
  return sessionScript(['Set tSC = $System.OBJ.Delete("ExecuteMCPv2.Setup","-d")', markerStatement('DELETE', STATUS_OUTCOME)]);
}

/**
 * Read what the namespace holds for `ExecuteMCPv2.Setup`: the `SETUP` marker is `absent`, `uncompiled`, or `compiled:` and the
 * compiled `BOOTSTRAPVERSION` (empty when the class has none), and `GUARD` says whether the install guard class is defined (`1`/`0`).
 */
export function setupStateScript() {
  return sessionScript([
    'Set tDefined = ##class(%Dictionary.ClassDefinition).%ExistsId("ExecuteMCPv2.Setup"), tCompiled = ##class(%Dictionary.CompiledClass).%ExistsId("ExecuteMCPv2.Setup")',
    'Set tVersion = "" Try { Set tVersion = $Parameter("ExecuteMCPv2.Setup","BOOTSTRAPVERSION") } Catch { Set tVersion = "<error>" }',
    'Set tState = $Select(\'tDefined:"absent",\'tCompiled:"uncompiled",1:"compiled:"_tVersion)',
    markerStatement('SETUP', 'tState'),
    markerStatement('GUARD', '##class(%Dictionary.ClassDefinition).%ExistsId("ExecuteMCPv2.InstallGuard")'),
  ]);
}

/**
 * The install checks of the matrix, in the session's namespace: `LISTED` (not used here; the `list` verb answers that), `COMPILED`
 * (the compiled, up-to-date `ExecuteMCPv2.*` classes that no other class generated), `TESTCLASSES` (how many of them are test or
 * fixture classes), `VERSION` (`GetBootstrapVersion()`), `APP` (the web application's namespace, dispatch class, enabled flag and
 * match roles, `|`-separated), `MAPPED` (whether `%ALL` maps the package), `HTTP` (the status of a GET on {@link REST_PROBE_ROUTE}
 * made from inside the container, as `_SYSTEM`), and `GUARDDOC` and `ABSENTDOC` (the status of an Atelier GET of the install guard's
 * document, which the bootstrap reads as the ownership signal, and of a document that does not exist, through the same route).
 */
export function installChecksScript() {
  // A request object of its own per application: the cookie the REST application sets is not the Atelier application's to read.
  const newRequest = `Set tReq = ##class(%Net.HttpRequest).%New() Set tReq.Server = "127.0.0.1" Set tReq.Port = ${CONTAINER_WEB_PORT} Do tReq.SetHeader("Authorization","Basic "_$System.Encryption.Base64Encode("${THROWAWAY_USERNAME}:${THROWAWAY_PASSWORD}"))`;
  return sessionScript([
    'Set tRS = ##class(%SQL.Statement).%ExecDirect(,"SELECT Name FROM %Dictionary.CompiledClass WHERE Name %STARTSWITH \'ExecuteMCPv2.\' AND (GeneratedBy IS NULL OR GeneratedBy = \'\')") Set tN = 0, tTest = 0 For  Quit:\'tRS.%Next()  Set tN = tN + \'\'$System.OBJ.IsUpToDate(tRS.%GetData(1)), tTest = tTest + ((tRS.%GetData(1) [ "ExecuteMCPv2.Tests.") || (tRS.%GetData(1) [ "QAFixtures"))',
    markerStatement('COMPILED', 'tN'),
    markerStatement('TESTCLASSES', 'tTest'),
    markerStatement('VERSION', '##class(ExecuteMCPv2.Setup).GetBootstrapVersion()'),
    `Set tHere = $Namespace Set $Namespace = "%SYS" Set tSC = ##class(Security.Applications).Get("${REST_APP}",.tProps) Set tApp = $Get(tProps("NameSpace"))_"|"_$Get(tProps("DispatchClass"))_"|"_$Get(tProps("Enabled"))_"|"_$Get(tProps("MatchRoles")) Set tMapped = ##class(Config.MapPackages).Exists("%ALL","ExecuteMCPv2") Set $Namespace = tHere`,
    markerStatement('APP', 'tApp'),
    markerStatement('MAPPED', 'tMapped'),
    newRequest,
    `Set tSC = tReq.Get("${REST_PROBE_ROUTE}")`,
    markerStatement('HTTP', '$Select($IsObject(tReq.HttpResponse):tReq.HttpResponse.StatusCode,1:"none")'),
    newRequest,
    `Set tSC = tReq.Get("${GUARD_DOCUMENT_ROUTE}"_$Namespace_"/doc/${GUARD_DOCUMENT}")`,
    markerStatement('GUARDDOC', '$Select($IsObject(tReq.HttpResponse):tReq.HttpResponse.StatusCode,1:"none")'),
    `Set tSC = tReq.Get("${GUARD_DOCUMENT_ROUTE}"_$Namespace_"/doc/${ABSENT_DOCUMENT}")`,
    markerStatement('ABSENTDOC', '$Select($IsObject(tReq.HttpResponse):tReq.HttpResponse.StatusCode,1:"none")'),
  ]);
}

/** Run `InstallGuard.Classify` over every case of a JSON file; the `PARITY` marker is the results, comma-separated, in case order. */
export function parityScript(casesFile) {
  return sessionScript([
    `Set tCases = ##class(%DynamicAbstractObject).%FromJSONFile("${casesFile}")`,
    'Set tIter = tCases.%GetIterator(), tOut = "" For  Quit:\'tIter.%GetNext(.tKey,.tCase)  Set tOut = tOut_##class(ExecuteMCPv2.InstallGuard).Classify(tCase.deployed,tCase.embedded)_","',
    markerStatement('PARITY', 'tOut'),
  ]);
}

// -- Synthetic fixtures -----------------------------------------------------------------

/**
 * The source of a one-class stand-in for `ExecuteMCPv2.Setup`. With a marker it carries `Parameter BOOTSTRAPVERSION`; with `null` it
 * is a class that defines no such parameter (a Setup the guard cannot read).
 *
 * @param {string | null} marker
 */
export function synthesizedSetup(marker) {
  if (marker !== null && !/^[\x20-\x7e]*$/.test(marker)) throw new Error(`a synthetic marker is printable ASCII: ${JSON.stringify(marker)}`);
  if (marker !== null && /["\\]/.test(marker)) throw new Error(`a synthetic marker holds no quote or backslash: ${JSON.stringify(marker)}`);
  const body = marker === null ? '' : `\nParameter BOOTSTRAPVERSION = "${marker}";\n`;
  return `/// A stand-in for ExecuteMCPv2.Setup that the install proof loads before the archive.\nClass ExecuteMCPv2.Setup Extends %RegisteredObject\n{\n${body}\n}\n`;
}

/**
 * The markers the guard legs seed, from the embedded marker: one newer (the sequence plus one), one older (the sequence minus one,
 * or the patch minus one when the sequence is 0), the placeholder `dev`, and `null` (no parameter).
 *
 * @param {string} embeddedMarker
 * @param {(marker: string) => { kind: string, semver?: readonly bigint[], sequence?: bigint, hash?: string }} parse
 */
export function seedMarkers(embeddedMarker, parse) {
  const parsed = parse(embeddedMarker);
  if (parsed.kind !== 'stamped') throw new Error(`the embedded marker ${JSON.stringify(embeddedMarker)} is not <semver>+<sequence>.<hash>.`);
  const render = (semver, sequence) => `${semver.join('.')}+${sequence}.${parsed.hash}`;
  let older;
  if (parsed.sequence > 0n) older = render(parsed.semver, parsed.sequence - 1n);
  else if (parsed.semver[2] > 0n) older = render([parsed.semver[0], parsed.semver[1], parsed.semver[2] - 1n], parsed.sequence);
  else throw new Error('the embedded marker has sequence 0 and patch 0, so no older marker can be built from it.');
  return { newer: render(parsed.semver, parsed.sequence + 1n), older, dev: 'dev', unknown: null };
}

// -- Reading outputs --------------------------------------------------------------------

/** `text` without terminal colour sequences and carriage returns. */
export function stripTerminal(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '');
}

/** The version `list` shows for `moduleName`, or `undefined` when the module is not listed. */
export function listedVersion(output, moduleName) {
  for (const line of stripTerminal(output).split('\n')) {
    const match = /^\s*(\S+)\s+(\S+)/.exec(line);
    if (match !== null && match[1].toLowerCase() === moduleName.toLowerCase()) return match[2];
  }
  return undefined;
}

/** The `.tgz` names in the `FILES` marker's value. */
export function archiveNames(filesValue) {
  return String(filesValue ?? '').split('|').filter((name) => name.endsWith('.tgz'));
}

/**
 * Cases that disagree: the results of `InstallGuard.Classify` (`irisResults`, one per case, in order) against `classify`, the TypeScript
 * comparator, and each case's `expected` against the same comparator. Empty means every case agrees. A result list of another length
 * than the case list is one problem, and no case is then compared.
 *
 * @param {ReadonlyArray<{ note?: string, deployed: string, embedded: string, expected?: string }>} cases
 * @param {readonly string[]} irisResults
 * @param {(deployed: string, embedded: string) => string} classify
 * @returns {string[]}
 */
export function parityProblems(cases, irisResults, classify) {
  if (cases.length === 0) return ['there are no parity cases: a comparison of nothing passes having compared nothing.'];
  if (irisResults.length !== cases.length) return [`InstallGuard.Classify answered ${irisResults.length} result(s) for ${cases.length} case(s).`];
  const problems = [];
  cases.forEach((entry, index) => {
    const reference = classify(entry.deployed, entry.embedded);
    const label = `case ${index}${entry.note === undefined ? '' : ` (${entry.note})`} ${JSON.stringify(entry.deployed)} against ${JSON.stringify(entry.embedded)}`;
    if (irisResults[index] !== reference) problems.push(`${label}: InstallGuard.Classify says ${JSON.stringify(irisResults[index])}, classifyDeployedMarker says ${JSON.stringify(reference)}.`);
    if (entry.expected !== undefined && entry.expected !== reference) {
      problems.push(`${label}: the table expects ${JSON.stringify(entry.expected)}, classifyDeployedMarker says ${JSON.stringify(reference)}.`);
    }
  });
  return problems;
}

/**
 * The verbs of the IPM commands in a session script: the first word of every `##class(%IPM.Main).Shell("...")` call. A verb that
 * cannot be read is reported as an empty string, so it can never pass as one of {@link IPM_VERBS}.
 *
 * @param {string} script
 * @returns {string[]}
 */
export function ipmVerbsOf(script) {
  return [...String(script).matchAll(/%IPM\.Main\)\.Shell\("([^"]*)"/g)].map((match) => match[1].trim().split(/\s+/)[0] ?? '');
}
