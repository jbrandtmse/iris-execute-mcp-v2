import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  databaseCheckTool,
  licenseInfoTool,
  ecpStatusTool,
} from "../tools/infrastructure.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_database_check ──────────────────────────────────

describe("iris_database_check", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(databaseCheckTool.scope).toBe("NONE");
  });

  it("should have readOnlyHint annotation", () => {
    expect(databaseCheckTool.annotations.readOnlyHint).toBe(true);
  });

  it("should call GET /monitor/database with no params", async () => {
    const dbData = {
      databases: [
        {
          name: "IRIS",
          directory: "c:\\intersystems\\irishealth\\mgr\\",
          mounted: true,
          readOnly: false,
          encrypted: false,
          journalState: 2,
          sizeMB: 1024,
          maxSizeMB: 0,
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(dbData));

    const result = await databaseCheckTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/monitor/database",
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(dbData);
  });

  it("should pass name query parameter when specified", async () => {
    const dbData = {
      databases: [
        {
          name: "USER",
          directory: "c:\\intersystems\\irishealth\\mgr\\user\\",
          mounted: true,
          readOnly: false,
          encrypted: false,
          journalState: 2,
          sizeMB: 512,
          maxSizeMB: 10240,
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(dbData));

    await databaseCheckTool.handler({ name: "USER" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("/api/executemcp/v2/monitor/database?");
    expect(calledPath).toContain("name=USER");
  });

  it("should format database info for display", async () => {
    const dbData = {
      databases: [
        {
          name: "IRIS",
          directory: "c:\\intersystems\\irishealth\\mgr\\",
          mounted: true,
          readOnly: false,
          encrypted: false,
          journalState: 2,
          sizeMB: 1024,
          maxSizeMB: 0,
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(dbData));

    const result = await databaseCheckTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Database Status (1 database(s)):");
    expect(text).toContain("IRIS:");
    expect(text).toContain("Mounted: Yes");
    expect(text).toContain("Read-Only: No");
    expect(text).toContain("Encrypted: No");
    expect(text).toContain("Journal State: 2");
    expect(text).toContain("Size: 1024 MB");
    expect(text).toContain("Max Size: Unlimited");
  });

  it("should display max size in MB when non-zero", async () => {
    const dbData = {
      databases: [
        {
          name: "USER",
          directory: "c:\\intersystems\\irishealth\\mgr\\user\\",
          mounted: true,
          readOnly: false,
          encrypted: false,
          journalState: 2,
          sizeMB: 512,
          maxSizeMB: 10240,
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(dbData));

    const result = await databaseCheckTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Max Size: 10240 MB");
  });

  it("should handle database with error gracefully", async () => {
    const dbData = {
      databases: [
        {
          name: "BROKEN",
          directory: "c:\\nonexistent\\",
          mounted: false,
          error: "Unable to open database",
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(dbData));

    const result = await databaseCheckTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("BROKEN:");
    expect(text).toContain("Error: Unable to open database");
  });

  it("should show no databases message when empty", async () => {
    const dbData = { databases: [], count: 0 };
    mockHttp.get.mockResolvedValue(envelope(dbData));

    const result = await databaseCheckTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("0 database(s)");
    expect(text).toContain("No databases found");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/monitor/database",
        "Server error",
      ),
    );

    const result = await databaseCheckTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error retrieving database status",
    );
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(databaseCheckTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });
});

// ── iris_license_info ────────────────────────────────────

describe("iris_license_info", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(licenseInfoTool.scope).toBe("NONE");
  });

  it("should have readOnlyHint annotation", () => {
    expect(licenseInfoTool.annotations.readOnlyHint).toBe(true);
  });

  it("should call GET /monitor/license", async () => {
    const licenseData = {
      customerName: "InterSystems IRIS Community",
      licenseCapacity: "InterSystems IRIS Community license",
      expirationDate: "2027-03-15",
      connectionLimit: 0,
      userLimit: 8,
      coresLicensed: 20,
      cpusLicensed: 20,
      currentCSPUsers: 2,
    };
    mockHttp.get.mockResolvedValue(envelope(licenseData));

    const result = await licenseInfoTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/monitor/license",
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(licenseData);
  });

  it("should format license info for display", async () => {
    const licenseData = {
      customerName: "InterSystems IRIS Community",
      licenseCapacity: "InterSystems IRIS Community license",
      expirationDate: "2027-03-15",
      connectionLimit: 0,
      userLimit: 8,
      coresLicensed: 20,
      cpusLicensed: 20,
      currentCSPUsers: 2,
    };
    mockHttp.get.mockResolvedValue(envelope(licenseData));

    const result = await licenseInfoTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("License Information:");
    expect(text).toContain("Customer: InterSystems IRIS Community");
    expect(text).toContain("Capacity: InterSystems IRIS Community license");
    expect(text).toContain("Expiration: 2027-03-15");
    expect(text).toContain("Connection Limit: Unlimited");
    expect(text).toContain("User Limit: 8");
    expect(text).toContain("Cores Licensed: 20");
    expect(text).toContain("CPUs Licensed: 20");
    expect(text).toContain("Current CSP Users: 2");
  });

  it("should show numeric connection limit when non-zero", async () => {
    const licenseData = {
      customerName: "Test Corp",
      licenseCapacity: "Enterprise",
      expirationDate: "2027-12-31",
      connectionLimit: 100,
      userLimit: 50,
      coresLicensed: 32,
      cpusLicensed: 32,
      currentCSPUsers: 10,
    };
    mockHttp.get.mockResolvedValue(envelope(licenseData));

    const result = await licenseInfoTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Connection Limit: 100");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/monitor/license",
        "Server error",
      ),
    );

    const result = await licenseInfoTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error retrieving license info");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(licenseInfoTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });
});

// ── iris_ecp_status ──────────────────────────────────────

describe("iris_ecp_status", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(ecpStatusTool.scope).toBe("NONE");
  });

  it("should have readOnlyHint annotation", () => {
    expect(ecpStatusTool.annotations.readOnlyHint).toBe(true);
  });

  it("should call GET /monitor/ecp", async () => {
    const ecpData = {
      configured: false,
      status: "ECP not configured",
    };
    mockHttp.get.mockResolvedValue(envelope(ecpData));

    const result = await ecpStatusTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/monitor/ecp",
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(ecpData);
  });

  it("should handle ECP not configured gracefully", async () => {
    const ecpData = {
      configured: false,
      status: "ECP not configured",
    };
    mockHttp.get.mockResolvedValue(envelope(ecpData));

    const result = await ecpStatusTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("ECP Status:");
    expect(text).toContain("Configured: No");
    expect(text).toContain("Status: ECP not configured");
    expect(text).not.toContain("Client Index:");
  });

  it("should display client index when ECP is configured", async () => {
    const ecpData = {
      configured: true,
      status: "ECP is configured",
      clientIndex: 3,
    };
    mockHttp.get.mockResolvedValue(envelope(ecpData));

    const result = await ecpStatusTool.handler({}, ctx);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Configured: Yes");
    expect(text).toContain("Status: ECP is configured");
    expect(text).toContain("Client Index: 3");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/monitor/ecp",
        "Server error",
      ),
    );

    const result = await ecpStatusTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error retrieving ECP status");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(ecpStatusTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });
});
