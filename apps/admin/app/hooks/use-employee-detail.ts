import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';

type EmployeeRole = {
  role: string;
  scopeType: string | null;
  scopeId: string | null;
};

type EmployeeCarrier = {
  id: string;
  name: string;
  role: string;
};

type EmployeeDetail = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  verified: boolean;
  avatarUrl: string | null;
  roles: EmployeeRole[];
  carriers: EmployeeCarrier[];
  createdAt: string;
  updatedAt: string;
};

type AuditLogEntry = {
  id: string;
  action: 'assigned' | 'revoked' | 'upgraded';
  role: string;
  scopeType: string | null;
  scopeId: string | null;
  performedBy: {
    id: string;
    name: string;
  };
  reason: string | null;
  createdAt: string;
};

type AuditLogMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type UpdateEmployeeData = {
  fullName?: string;
  phone?: string;
  email?: string;
};

type AssignRoleData = {
  userId: string;
  role: string;
  scopeType?: string | null;
  scopeId?: string | null;
};

type RevokeRoleData = {
  userId: string;
  role: string;
  scopeType?: string | null;
  scopeId?: string | null;
  reason?: string;
};

type Mutations = {
  updateEmployee: (data: UpdateEmployeeData) => Promise<void>;
  deactivate: () => Promise<void>;
  reactivate: () => Promise<void>;
  assignRole: (data: AssignRoleData) => Promise<void>;
  revokeRole: (data: RevokeRoleData) => Promise<void>;
};

type UseEmployeeDetailResult = {
  employee: EmployeeDetail | null;
  auditLog: AuditLogEntry[];
  auditLogMeta: AuditLogMeta | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  mutations: Mutations;
};

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function apiRequest(
  getToken: () => Promise<string | null>,
  url: string,
  options: RequestInit = {},
  signal?: AbortSignal
): Promise<Response> {
  const accessToken = await getToken();

  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal,
  });
}

export function useEmployeeDetail(userId: string): UseEmployeeDetailResult {
  const { getToken } = useAuth();
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [auditLogMeta, setAuditLogMeta] = useState<AuditLogMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const accessToken = await getToken();

      if (!accessToken) {
        setError('Not authenticated');
        setIsLoading(false);
        return;
      }

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      };

      // Fetch employee detail and audit log in parallel
      const [employeeRes, auditRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/admin/users/${userId}`, {
          headers,
          signal: controller.signal,
        }),
        fetch(`${API_URL}/api/v1/admin/users/${userId}/audit-log`, {
          headers,
          signal: controller.signal,
        }),
      ]);

      if (!employeeRes.ok) {
        const body = await employeeRes.json().catch(() => null);
        const message = body?.error?.message || `Request failed with status ${employeeRes.status}`;
        setError(message);
        setEmployee(null);
        setIsLoading(false);
        return;
      }

      const employeeBody = await employeeRes.json();
      setEmployee(employeeBody.data ?? null);

      if (auditRes.ok) {
        const auditBody = await auditRes.json();
        setAuditLog(auditBody.data ?? []);
        setAuditLogMeta(auditBody.meta ?? null);
      } else {
        // Audit log failure is non-critical — show employee data anyway
        setAuditLog([]);
        setAuditLogMeta(null);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // Request was cancelled, don't update state
      }
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setEmployee(null);
      setAuditLog([]);
      setAuditLogMeta(null);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [userId]);

  useEffect(() => {
    fetchData();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchData]);

  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // Mutation functions
  const updateEmployee = useCallback(
    async (data: UpdateEmployeeData) => {
      const response = await apiRequest(getToken,`${API_URL}/api/v1/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message || `Update failed with status ${response.status}`);
      }

      // Refetch to get updated data
      await fetchData();
    },
    [userId, fetchData]
  );

  const deactivate = useCallback(async () => {
    const response = await apiRequest(getToken,`${API_URL}/api/v1/admin/users/${userId}/deactivate`, {
      method: 'POST',
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        body?.error?.message || `Deactivation failed with status ${response.status}`
      );
    }

    // Refetch to get updated data
    await fetchData();
  }, [userId, fetchData]);

  const reactivate = useCallback(async () => {
    const response = await apiRequest(getToken,`${API_URL}/api/v1/admin/users/${userId}/reactivate`, {
      method: 'POST',
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        body?.error?.message || `Reactivation failed with status ${response.status}`
      );
    }

    // Refetch to get updated data
    await fetchData();
  }, [userId, fetchData]);

  const assignRole = useCallback(
    async (data: AssignRoleData) => {
      // Delegates to existing RBAC role routes: POST /api/v1/admin/users/:userId/roles
      // The RoleService handles syncRolesToAuth after assignment (Requirement 5.7)
      const response = await apiRequest(getToken,
        `${API_URL}/api/v1/admin/users/${data.userId}/roles`,
        {
          method: 'POST',
          body: JSON.stringify({
            role: data.role,
            scopeType: data.scopeType ?? null,
            scopeId: data.scopeId ?? null,
          }),
        }
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error?.message || `Role assignment failed with status ${response.status}`
        );
      }

      // Refetch to get updated data
      await fetchData();
    },
    [fetchData]
  );

  const revokeRole = useCallback(
    async (data: RevokeRoleData) => {
      // Delegates to existing RBAC role routes: DELETE /api/v1/admin/users/:userId/roles
      // The RoleService handles syncRolesToAuth after revocation (Requirement 5.7)
      const response = await apiRequest(getToken,
        `${API_URL}/api/v1/admin/users/${data.userId}/roles`,
        {
          method: 'DELETE',
          body: JSON.stringify({
            role: data.role,
            scopeId: data.scopeId ?? null,
            reason: data.reason,
          }),
        }
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error?.message || `Role revocation failed with status ${response.status}`
        );
      }

      // Refetch to get updated data
      await fetchData();
    },
    [fetchData]
  );

  const mutations: Mutations = {
    updateEmployee,
    deactivate,
    reactivate,
    assignRole,
    revokeRole,
  };

  return { employee, auditLog, auditLogMeta, isLoading, error, refetch, mutations };
}
