// A company that has opted in to task-gated applications is labelled a concept preview: the idea is not a product yet, so it
// is never offered as one. Nothing in the data opts a company in today, so nothing shows; a task-gate flag with no opt-in is not
// shown at all (it was never a thing a company agreed to).
export default function ConceptPreview({ company }) {
  if (company?.taskGate?.optedIn !== true) return null;
  return <span className="concept-label" title="Task-gated applications are a concept preview, not a live product">Concept preview</span>;
}
