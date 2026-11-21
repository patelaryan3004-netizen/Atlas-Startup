import { INTENTS, labelOf } from './intents.js';
import { CheckIcon } from '../explore/icons.jsx';

// "What would you like to do today?": eight things a visitor can come for, none required. A choice is a toggle (press it again to clear it), can be changed at any time, and only changes what the page
// leads with. Nothing is asked afterwards and nothing is sent anywhere. The state is spoken as well as shown (a tick and aria-pressed), never by colour alone.
export default function IntentPicker({ value, onChange }) {
  return (
    <section className="cm-intent" aria-labelledby="cm-intent-h">
      <div className="cm-intent-in">
        <h1 id="cm-intent-h" className="cm-title">What would you like to do <em>today?</em></h1>
        <p className="cm-intent-lede">Pick one if it helps, or just look around. You can change it or clear it whenever you like.</p>
        <div className="cm-intents" role="group" aria-label="What would you like to do today?">
          {INTENTS.map((i) => (
            <button key={i.id} type="button" className="cm-intent-btn" aria-pressed={value === i.id} onClick={() => onChange(value === i.id ? '' : i.id)}>
              {value === i.id && <CheckIcon size={16} />}
              <span>{i.label}</span>
            </button>
          ))}
        </div>
        <p className="cm-intent-status" role="status" aria-live="polite">
          {value
            ? <>Showing what fits <strong>{labelOf(value)}</strong>. <button type="button" className="cm-link" onClick={() => onChange('')}>Clear</button></>
            : 'No choice made: everything is shown below.'}
        </p>
      </div>
    </section>
  );
}
