/**
 * The patterns the documentation tests of the PHI data policy stories look for in a document (AD-26: no
 * document or listing claims regulatory compliance). Shared by `story-39-2-doc-claims.test.ts` and
 * `story-39-3-doc-claims.test.ts`, so the two scans cannot drift apart.
 */

/** Wording that claims regulatory compliance or de-identification. */
export const CLAIMS: RegExp[] = [
  /\b(?:HIPAA|GDPR|HITECH)[- ]?(?:compliant|compliance|certified)\b/i,
  /\bcompliant with\b/i,
  /\b(?:ensures?|guarantees?|achieves?|provides?|delivers?|certif(?:y|ies))\s+(?:HIPAA\s+)?(?:compliance|de-?identification)\b/i,
  /\bde-?identif(?:ied|ication) (?:data|output|text|messages?)\b/i,
  /\bsafe harbor (?:compliant|compliance|certified)\b/i,
];

/** Wording that says the resend preview shows redacted HL7 text, which it never does. */
export const REDACTED_TEXT_SHOWN: RegExp[] = [
  /\b(?:shows?|displays?|returns?|prints?|renders?)\s+(?:the\s+)?redacted\s+(?:HL7|ER7|body|message|text)/i,
  /\bredacted\s+(?:HL7|ER7)\s+(?:text\s+)?(?:is|are)\s+(?:shown|returned|displayed)/i,
];
