// List projects and create new ones. Meetings and decisions belong to a project.
import { useState } from "react";
import { useApp } from "../context.jsx";
import { api } from "../api.js";

export default function Projects() {
  const { projects, projectId, setProjectId, loadProjects } = useApp();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  async function create(e) {
    e.preventDefault();
    setError("");
    try {
      const p = await api.post("/projects", { name, description });
      await loadProjects();
      setProjectId(p.id);
      setName("");
      setDescription("");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">Projects</h1>

      <form onSubmit={create} className="card space-y-3">
        <h2 className="font-semibold">New project</h2>
        <input className="input" placeholder="Project name, e.g. Campus Connect App" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="input" placeholder="Short description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary">Create project</button>
      </form>

      <div className="card p-0">
        {projects.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No projects yet. Create one above.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center justify-between p-4">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-sm text-slate-500">
                    {p.description || "No description"} · {p.meeting_count} meeting(s)
                  </div>
                </div>
                {p.id === projectId ? (
                  <span className="text-sm font-medium text-indigo-600">Selected</span>
                ) : (
                  <button className="btn-secondary" onClick={() => setProjectId(p.id)}>
                    Select
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
