# iris-execute-mcp-v2

> **This project is under construction.**

More details coming soon.

## Known Limitations

### Web Application Gateway Registration

When the MCP server auto-bootstraps its custom REST endpoint, it creates the
web application via `Security.Applications.Create()`. However, this ObjectScript
API call does **not** notify the CSP Gateway of the new application. As a result,
requests to the new web app may return 404 until one of the following steps is
taken:

1. **Save via System Management Portal (SMP):** Navigate to
   *System Administration > Security > Applications > Web Applications*, open the
   newly created web application, and click **Save**. This triggers the gateway
   registration automatically.
2. **Restart the CSP Gateway:** If SMP access is not available, restart the
   CSP Gateway service (or restart the IRIS instance) to force the gateway to
   reload its application table.
