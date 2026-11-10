// Form to schedule a meeting (SPEC §10.3). Type a participant name and press Enter to add.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../context.jsx";

export default function NewMeeting() {
  const { projectId, project } = useApp();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [participantInput, setParticipantInput] = useState("");
  const [participants, setParticipants] = useState(["Priya", "Ravi", "Sneha", "Arjun"]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function addParticipant(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const name = participantInput.trim();
    if (!name) return;
    if (!participants.includes(name)) setParticipants((list) => [...list, name]);
    setParticipantInput("");
  }

  function removeParticipant(name) {
    setParticipants((list) => list.filter((n) => n !== name));
  }

  async function submit(e) {
    e.preventDefault();
    if (!projectId) {
      setError("Select a project first");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // datetime-local → ISO-ish string the server stores as-is
      const meeting = await api.post("/meetings", {
        projectId,
        title,
        agenda,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        participants,
      });
      navigate(`/meetings/${meeting.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!projectId) {
    return (
      <div className="card text-sm text-slate-500">
        <Link className="text-indigo-600" to="/projects">
          Create a project
        </Link>{" "}
        before scheduling a meeting.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link to="/meetings" className="text-sm text-indigo-600">
          ← Meetings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New meeting</h1>
        <p className="text-sm text-slate-500">Project: {project?.name}</p>
      </div>

      <form onSubmit={submit} className="card space-y-4">
        <div>
          <label className="label" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Sprint 2 Planning"
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="agenda">
            Agenda
          </label>
          <textarea
            id="agenda"
            className="input min-h-24"
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            placeholder="What will you discuss?"
          />
        </div>

        <div>
          <label className="label" htmlFor="when">
            Date & time
          </label>
          <input
            id="when"
            type="datetime-local"
            className="input"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="participant">
            Participants
          </label>
          <input
            id="participant"
            className="input"
            value={participantInput}
            onChange={(e) => setParticipantInput(e.target.value)}
            onKeyDown={addParticipant}
            placeholder="Type a name and press Enter"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {participants.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm"
              >
                {name}
                <button
                  type="button"
                  className="text-slate-500 hover:text-red-600"
                  onClick={() => removeParticipant(name)}
                  aria-label={`Remove ${name}`}
                >
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Create meeting"}
          </button>
          <Link to="/meetings" className="btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
