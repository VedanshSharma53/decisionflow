// Temporary page for screens that are built in later steps
export default function Placeholder({ title, step }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="card text-sm text-slate-500">This page is built in Step {step} of the build guide.</div>
    </div>
  );
}
