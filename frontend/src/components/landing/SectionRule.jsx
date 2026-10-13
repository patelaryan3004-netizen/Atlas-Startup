// The line a section opens on: its number and its name ("01 Map"), in small monospace. It is for the eye (the section's heading
// names it for everyone else), so it is hidden from a screen reader rather than read out as a number and a word before the heading.
export default function SectionRule({ number, name }) {
  return (
    <div className="sec-rule" aria-hidden="true">
      <span className="sec-no">{String(number).padStart(2, '0')}</span>
      <span className="sec-name">{name}</span>
    </div>
  );
}
