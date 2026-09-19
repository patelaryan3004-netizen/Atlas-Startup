import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PrivacyPolicy from '../../src/components/PrivacyPolicy.jsx';

describe('PrivacyPolicy', () => {
  it('describes what is collected from the submission forms', () => {
    render(<PrivacyPolicy onClose={() => {}} />);
    expect(screen.getByText(/Suggest an edit/)).toBeInTheDocument();
    expect(screen.getByText(/review queue/)).toBeInTheDocument();
  });

  it('states no accounts, tracking cookies, or analytics are used', () => {
    render(<PrivacyPolicy onClose={() => {}} />);
    expect(screen.getByText(/No account, no tracking cookies, no analytics pixel/)).toBeInTheDocument();
  });

  it('flags business details as an unfilled placeholder rather than fabricating them', () => {
    render(<PrivacyPolicy onClose={() => {}} />);
    expect(screen.getByText(/Placeholder — operator name, ABN, and contact details/)).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<PrivacyPolicy onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking the overlay outside the panel', async () => {
    const onClose = vi.fn();
    const { container } = render(<PrivacyPolicy onClose={onClose} />);
    await userEvent.click(container.querySelector('.modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
