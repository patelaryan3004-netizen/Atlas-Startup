// One endorsement: what the person said, set as a quotation, then who said it and in what role, in muted text. It shows only what it was
// given; with no words it is only the name, and with neither it is nothing. Whether to show a vouch at all (it must be consented to) is
// decided before it gets here.
export default function Vouch({ name, role, note }) {
  if (!note && !name) return null;
  return (
    <figure className="vouch">
      {note && <blockquote><p>{note}</p></blockquote>}
      {name && <figcaption><b>{name}</b>{role ? `, ${role}` : ''}</figcaption>}
    </figure>
  );
}
