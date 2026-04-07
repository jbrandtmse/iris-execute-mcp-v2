/// Main REST dispatch class for the ExecuteMCPv2 custom REST service.
/// <p>Extends <class>%Atelier.REST</class> to inherit the three-part response envelope
/// (<code>{status, console, result}</code>), <method>StatusToJSON</method> error formatting,
/// and ETag/caching support.</p>
/// <p>The URL prefix for this application is <code>/api/executemcp/v2/</code>.
/// Routes are defined in the <xdata>UrlMap</xdata> XData block below.</p>
Class ExecuteMCPv2.REST.Dispatch Extends %Atelier.REST
{

/// URL routing map for ExecuteMCPv2 REST endpoints.
/// <p>
/// <b>Epic 3 routes</b> (command execution, unit tests, globals):
/// </p>
/// <p>
/// Future epics will add routes here:
/// <ul>
///   <li>Epic 4: <code>/config/:entity</code> - Configuration handler</li>
///   <li>Epic 5: <code>/production/:action</code> - Interoperability handler</li>
///   <li>Epic 6: <code>/system/:metric</code> - Ops handler</li>
///   <li>Epic 7: <code>/data/:action</code> - Data and analytics handler</li>
/// </ul>
/// </p>
XData UrlMap [ XMLNamespace = "http://www.intersystems.com/urlmap" ]
{
<Routes>
  <!-- Epic 3: Command Execution -->
  <Route Url="/command" Method="POST" Call="ExecuteMCPv2.REST.Command:Execute" />
  <Route Url="/classmethod" Method="POST" Call="ExecuteMCPv2.REST.Command:ClassMethod" />

  <!-- Epic 3: Unit Test Execution -->
  <Route Url="/tests" Method="POST" Call="ExecuteMCPv2.REST.UnitTest:RunTests" />

  <!-- Epic 3: Global Operations -->
  <Route Url="/global" Method="GET" Call="ExecuteMCPv2.REST.Global:GetGlobal" />
  <Route Url="/global" Method="PUT" Call="ExecuteMCPv2.REST.Global:SetGlobal" />
  <Route Url="/global" Method="DELETE" Call="ExecuteMCPv2.REST.Global:KillGlobal" />
  <Route Url="/global/list" Method="GET" Call="ExecuteMCPv2.REST.Global:ListGlobals" />

  <!-- Epic 4: Configuration Management -->
  <Route Url="/config/namespace" Method="GET" Call="ExecuteMCPv2.REST.Config:NamespaceList" />
  <Route Url="/config/namespace" Method="POST" Call="ExecuteMCPv2.REST.Config:NamespaceManage" />
  <Route Url="/config/database" Method="GET" Call="ExecuteMCPv2.REST.Config:DatabaseList" />
  <Route Url="/config/database" Method="POST" Call="ExecuteMCPv2.REST.Config:DatabaseManage" />
  <Route Url="/config/mapping/:type" Method="GET" Call="ExecuteMCPv2.REST.Config:MappingList" />
  <Route Url="/config/mapping/:type" Method="POST" Call="ExecuteMCPv2.REST.Config:MappingManage" />

  <!-- Epic 4: Security / User Management -->
  <Route Url="/security/user" Method="GET" Call="ExecuteMCPv2.REST.Security:UserList" />
  <Route Url="/security/user" Method="POST" Call="ExecuteMCPv2.REST.Security:UserManage" />
  <Route Url="/security/user/:name" Method="GET" Call="ExecuteMCPv2.REST.Security:UserGet" />
  <Route Url="/security/user/roles" Method="POST" Call="ExecuteMCPv2.REST.Security:UserRoles" />
  <Route Url="/security/user/password" Method="POST" Call="ExecuteMCPv2.REST.Security:UserPassword" />

  <!-- Epic 4: Security / Role Management -->
  <Route Url="/security/role" Method="GET" Call="ExecuteMCPv2.REST.Security:RoleList" />
  <Route Url="/security/role" Method="POST" Call="ExecuteMCPv2.REST.Security:RoleManage" />

  <!-- Epic 4: Security / Resource Management -->
  <Route Url="/security/resource" Method="GET" Call="ExecuteMCPv2.REST.Security:ResourceList" />
  <Route Url="/security/resource" Method="POST" Call="ExecuteMCPv2.REST.Security:ResourceManage" />

  <!-- Epic 4: Security / Permission Check -->
  <Route Url="/security/permission" Method="POST" Call="ExecuteMCPv2.REST.Security:PermissionCheck" />

  <!-- Epic 4: Security / Web Application Management -->
  <Route Url="/security/webapp" Method="GET" Call="ExecuteMCPv2.REST.Security:WebAppList" />
  <Route Url="/security/webapp" Method="POST" Call="ExecuteMCPv2.REST.Security:WebAppManage" />
  <Route Url="/security/webapp/:name" Method="GET" Call="ExecuteMCPv2.REST.Security:WebAppGet" />

  <!-- Epic 4: Security / SSL/TLS Configuration Management -->
  <Route Url="/security/ssl" Method="GET" Call="ExecuteMCPv2.REST.Security:SSLList" />
  <Route Url="/security/ssl" Method="POST" Call="ExecuteMCPv2.REST.Security:SSLManage" />

  <!-- Epic 4: Security / OAuth2 Configuration Management -->
  <Route Url="/security/oauth" Method="GET" Call="ExecuteMCPv2.REST.Security:OAuthList" />
  <Route Url="/security/oauth" Method="POST" Call="ExecuteMCPv2.REST.Security:OAuthManage" />

  <!-- Epic 5: Interoperability Management -->
  <Route Url="/interop/production/status" Method="GET" Call="ExecuteMCPv2.REST.Interop:ProductionStatus" />
  <Route Url="/interop/production/summary" Method="GET" Call="ExecuteMCPv2.REST.Interop:ProductionSummary" />
  <Route Url="/interop/production" Method="POST" Call="ExecuteMCPv2.REST.Interop:ProductionManage" />
  <Route Url="/interop/production/control" Method="POST" Call="ExecuteMCPv2.REST.Interop:ProductionControl" />
  <Route Url="/interop/production/item" Method="POST" Call="ExecuteMCPv2.REST.Interop:ItemManage" />
  <Route Url="/interop/production/autostart" Method="POST" Call="ExecuteMCPv2.REST.Interop:AutoStart" />

  <!-- Epic 5: Production Monitoring -->
  <Route Url="/interop/production/logs" Method="GET" Call="ExecuteMCPv2.REST.Interop:EventLog" />
  <Route Url="/interop/production/queues" Method="GET" Call="ExecuteMCPv2.REST.Interop:QueueStatus" />
  <Route Url="/interop/production/messages" Method="GET" Call="ExecuteMCPv2.REST.Interop:MessageTrace" />
  <Route Url="/interop/production/adapters" Method="GET" Call="ExecuteMCPv2.REST.Interop:AdapterList" />

  <!-- Epic 5: Credentials and Lookup Tables -->
  <Route Url="/interop/credential" Method="GET" Call="ExecuteMCPv2.REST.Interop:CredentialList" />
  <Route Url="/interop/credential" Method="POST" Call="ExecuteMCPv2.REST.Interop:CredentialManage" />
  <Route Url="/interop/lookup" Method="POST" Call="ExecuteMCPv2.REST.Interop:LookupManage" />
  <Route Url="/interop/lookup/transfer" Method="POST" Call="ExecuteMCPv2.REST.Interop:LookupTransfer" />

  <!-- Epic 5: Rules, Transforms, and REST API -->
  <Route Url="/interop/rule" Method="GET" Call="ExecuteMCPv2.REST.Interop:RuleList" />
  <Route Url="/interop/rule/get" Method="GET" Call="ExecuteMCPv2.REST.Interop:RuleGet" />
  <Route Url="/interop/transform" Method="GET" Call="ExecuteMCPv2.REST.Interop:TransformList" />
  <Route Url="/interop/transform/test" Method="POST" Call="ExecuteMCPv2.REST.Interop:TransformTest" />
  <Route Url="/interop/rest" Method="POST" Call="ExecuteMCPv2.REST.Interop:RestManage" />

  <!-- Epic 6: Operations and Monitoring -->
  <Route Url="/monitor/system" Method="GET" Call="ExecuteMCPv2.REST.Monitor:SystemMetrics" />
  <Route Url="/monitor/alerts" Method="GET" Call="ExecuteMCPv2.REST.Monitor:SystemAlerts" />
  <Route Url="/monitor/interop" Method="GET" Call="ExecuteMCPv2.REST.Monitor:InteropMetrics" />
  <Route Url="/monitor/jobs" Method="GET" Call="ExecuteMCPv2.REST.Monitor:JobsList" />
  <Route Url="/monitor/locks" Method="GET" Call="ExecuteMCPv2.REST.Monitor:LocksList" />
  <Route Url="/monitor/journal" Method="GET" Call="ExecuteMCPv2.REST.Monitor:JournalInfo" />
  <Route Url="/monitor/mirror" Method="GET" Call="ExecuteMCPv2.REST.Monitor:MirrorStatus" />
  <Route Url="/monitor/audit" Method="GET" Call="ExecuteMCPv2.REST.Monitor:AuditEvents" />
  <Route Url="/monitor/database" Method="GET" Call="ExecuteMCPv2.REST.Monitor:DatabaseCheck" />
  <Route Url="/monitor/license" Method="GET" Call="ExecuteMCPv2.REST.Monitor:LicenseInfo" />
  <Route Url="/monitor/ecp" Method="GET" Call="ExecuteMCPv2.REST.Monitor:ECPStatus" />

  <!-- Epic 6: Task Scheduling -->
  <Route Url="/task/list" Method="GET" Call="ExecuteMCPv2.REST.Task:TaskList" />
  <Route Url="/task/manage" Method="POST" Call="ExecuteMCPv2.REST.Task:TaskManage" />
  <Route Url="/task/run" Method="POST" Call="ExecuteMCPv2.REST.Task:TaskRun" />
  <Route Url="/task/history" Method="GET" Call="ExecuteMCPv2.REST.Task:TaskHistory" />

  <!-- Epic 6: System Configuration -->
  <Route Url="/system/config" Method="POST" Call="ExecuteMCPv2.REST.SystemConfig:ConfigManage" />

  <!-- Epic 7: Analytics -->
  <Route Url="/analytics/mdx" Method="POST" Call="ExecuteMCPv2.REST.Analytics:ExecuteMDX" />
  <Route Url="/analytics/cubes" Method="GET" Call="ExecuteMCPv2.REST.Analytics:CubeList" />
  <Route Url="/analytics/cubes" Method="POST" Call="ExecuteMCPv2.REST.Analytics:CubeAction" />
</Routes>
}

}
