"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "sonner";
import {
  Plus, UserPlus, UserX, Shield, ShieldOff, Trash2, Loader2,
} from "lucide-react";

function UserRow({ user, onToggleActive, onDelete, onManageMemberships }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        borderBottom: "1px solid var(--sketch-line)",
      }}
    >
      <div style={{ flex: 2, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 13,
            fontWeight: 500,
            color: "var(--sketch-ink)",
          }}
        >
          {user.name}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 10,
            color: "var(--sketch-ink-faint)",
          }}
        >
          {user.email}
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <Badge variant={user.role === "admin" ? "default" : "secondary"} className="text-xs capitalize">
          {user.role}
        </Badge>
      </div>
      <div style={{ flex: 1 }}>
        <Badge variant={user.isActive ? "outline" : "destructive"} className="text-xs">
          {user.isActive ? "Active" : "Inactive"}
        </Badge>
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 10,
            color: "var(--sketch-ink-faint)",
          }}
        >
          {user.brandMemberships?.length ?? 0} brands
        </div>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onManageMemberships(user)}
          title="Manage brand memberships"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onToggleActive(user)}
          title={user.isActive ? "Deactivate" : "Activate"}
        >
          {user.isActive ? <UserX className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(user)}
          title="Delete user"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function NewUserForm({ brands, onCreated }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [selectedBrands, setSelectedBrands] = useState([]);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim(), password, role }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create user.");
      }
      const user = await res.json();

      for (const brandId of selectedBrands) {
        await fetch(`/api/admin/users/${user.id}/memberships`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brandId }),
        });
      }

      toast.success("User created.");
      onCreated();
      setEmail("");
      setName("");
      setPassword("");
      setRole("user");
      setSelectedBrands([]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  function toggleBrand(brandId) {
    setSelectedBrands((prev) =>
      prev.includes(brandId) ? prev.filter((id) => id !== brandId) : [...prev, brandId]
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8 }}>
        <Input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          type="password"
          placeholder="Temporary password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          style={{
            padding: "6px 10px",
            borderRadius: 4,
            border: "1px solid var(--sketch-line)",
            fontFamily: "var(--font-mono-ink)",
            fontSize: 11,
            background: "var(--sketch-paper-bright)",
            color: "var(--sketch-ink)",
          }}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {brands.length > 0 && (
        <div>
          <div
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--sketch-ink-faint)",
              marginBottom: 6,
            }}
          >
            Assign brand access (optional)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {brands.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => toggleBrand(b.id)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: "1px solid var(--sketch-line)",
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 10,
                  background: selectedBrands.includes(b.id) ? "var(--sketch-ink)" : "transparent",
                  color: selectedBrands.includes(b.id) ? "var(--sketch-paper-bright)" : "var(--sketch-ink)",
                  cursor: "pointer",
                }}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <Button type="submit" disabled={saving} size="sm" className="gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
          {saving ? "Creating…" : "Create User"}
        </Button>
      </div>
    </form>
  );
}

function MembershipModal({ user, brands, onClose }) {
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchMemberships = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/memberships`);
      if (res.ok) setMemberships(await res.json());
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => { fetchMemberships(); }, [fetchMemberships]);

  const unassignedBrands = brands.filter(
    (b) => !memberships.some((m) => m.brandId === b.id)
  );

  async function addBrand(brandId) {
    try {
      const res = await fetch(`/api/admin/users/${user.id}/memberships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add brand.");
      }
      toast.success("Brand assigned.");
      fetchMemberships();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeBrand(brandId) {
    try {
      const res = await fetch(`/api/admin/users/${user.id}/memberships?brandId=${brandId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove brand.");
      }
      toast.success("Brand removed.");
      fetchMemberships();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--sketch-paper-bright)",
          borderRadius: 8,
          padding: 24,
          maxWidth: 480,
          width: "90%",
          maxHeight: "80vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--sketch-ink)",
            margin: "0 0 4px",
          }}
        >
          Brand Memberships
        </h3>
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 10,
            color: "var(--sketch-ink-faint)",
            marginBottom: 16,
          }}
        >
          {user.name} ({user.email})
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 20 }}>
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          </div>
        ) : (
          <>
            {memberships.length === 0 ? (
              <div
                style={{
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 11,
                  color: "var(--sketch-ink-faint)",
                  padding: "12px 0",
                }}
              >
                No brands assigned yet.
              </div>
            ) : (
              <div style={{ marginBottom: 16 }}>
                {memberships.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 0",
                      borderBottom: "1px solid var(--sketch-line)",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: "var(--font-mono-ink)",
                          fontSize: 12,
                          color: "var(--sketch-ink)",
                        }}
                      >
                        {m.brand.name}
                      </div>
                      <Badge variant="secondary" className="text-xs">{m.role}</Badge>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => removeBrand(m.brandId)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {unassignedBrands.length > 0 && (
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--sketch-ink-faint)",
                    marginBottom: 8,
                  }}
                >
                  Add brand
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {unassignedBrands.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => addBrand(b.id)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 4,
                        border: "1px solid var(--sketch-line)",
                        fontFamily: "var(--font-mono-ink)",
                        fontSize: 10,
                        background: "transparent",
                        color: "var(--sketch-ink)",
                        cursor: "pointer",
                      }}
                    >
                      + {b.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 16, textAlign: "right" }}>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [membershipUser, setMembershipUser] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, brandsRes] = await Promise.all([
        fetch("/api/admin/users"),
        fetch("/api/brands"),
      ]);
      if (usersRes.ok) setUsers(await usersRes.json());
      if (brandsRes.ok) setBrands(await brandsRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleToggleActive(user) {
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update user.");
      }
      toast.success(`User ${user.isActive ? "deactivated" : "activated"}.`);
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleDelete(user) {
    if (!confirm(`Delete user "${user.name}" (${user.email})? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete user.");
      }
      toast.success("User deleted.");
      fetchData();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Settings"
        title="User Management"
        description="Create and manage user accounts and brand access."
      />

      {loading ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Loader2 className="w-6 h-6 animate-spin mx-auto" />
        </div>
      ) : (
        <>
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-base">Create New User</CardTitle>
            </CardHeader>
            <CardContent>
              <NewUserForm brands={brands} onCreated={fetchData} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Users ({users.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* Header row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 16px",
                  borderBottom: "1px solid var(--sketch-line)",
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 9.5,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--sketch-ink-faint)",
                }}
              >
                <div style={{ flex: 2 }}>User</div>
                <div style={{ flex: 1 }}>Role</div>
                <div style={{ flex: 1 }}>Status</div>
                <div style={{ flex: 1 }}>Brands</div>
                <div style={{ width: 120 }}>Actions</div>
              </div>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  onToggleActive={handleToggleActive}
                  onDelete={handleDelete}
                  onManageMemberships={setMembershipUser}
                />
              ))}
              {users.length === 0 && (
                <div
                  style={{
                    padding: 24,
                    textAlign: "center",
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 11,
                    color: "var(--sketch-ink-faint)",
                  }}
                >
                  No users yet.
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {membershipUser && (
        <MembershipModal
          user={membershipUser}
          brands={brands}
          onClose={() => setMembershipUser(null)}
        />
      )}
    </PageContainer>
  );
}
