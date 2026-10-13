import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import VerifiedNote, { UnverifiedBadge } from '../../src/components/VerifiedNote.jsx';

const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

describe('the verified note every card shares', () => {
  it('says when a company was last checked, in words', () => {
    render(<VerifiedNote at={ago(3)} />);
    expect(screen.getByText('Verified 3 days ago')).toHaveClass('verified-note');
    expect(screen.getByText('Verified 3 days ago')).not.toHaveClass('verified-note-stale');
  });

  it('says "Needs re-check", muted, once the check is over 60 days old, and not how many days', () => {
    render(<VerifiedNote at={ago(61)} />);
    expect(screen.getByText('Needs re-check')).toHaveClass('verified-note', 'verified-note-stale');
    expect(screen.queryByText(/Verified/)).toBeNull();
  });

  it('keeps "Verified 8 weeks ago" up to the 60th day', () => {
    render(<VerifiedNote at={ago(60)} />);
    expect(screen.getByText('Verified 8 weeks ago')).not.toHaveClass('verified-note-stale');
  });

  it('says nothing for a company with no check date: no placeholder, no "N/A"', () => {
    for (const at of [undefined, null, '', 'yesterday-ish']) {
      const { container, unmount } = render(<VerifiedNote at={at} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe('the Unverified badge', () => {
  it('marks only a company whose record says it is not verified', () => {
    render(<UnverifiedBadge company={{ verified: false }} />);
    expect(screen.getByText('Unverified')).toHaveClass('badge-unverified');
  });

  it('says nothing for a verified company, or for a record that does not say (a pin that has not been filled in yet)', () => {
    for (const company of [{ verified: true }, {}, null, undefined]) {
      const { container, unmount } = render(<UnverifiedBadge company={company} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
