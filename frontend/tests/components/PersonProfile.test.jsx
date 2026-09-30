import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PersonProfile from '../../src/components/PersonProfile.jsx';

function person(overrides = {}) {
  return {
    name: 'Melanie Perkins',
    roles: ['Founder'],
    role: 'Founder',
    currentCompany: 'Canva',
    foundedAt: [{ company: 'Canva', website: 'https://www.canva.com' }],
    notableWork: null,
    link: null,
    previousCompanies: [],
    industry: null,
    location: null,
    relationships: [],
    ...overrides,
  };
}

describe('PersonProfile', () => {
  it('shows the name, role text and role chips', () => {
    render(<PersonProfile person={person({ roles: ['Founder', 'Investor'] })} onClose={() => {}} />);
    expect(screen.getByText('Melanie Perkins')).toBeInTheDocument();
    expect(screen.getByText('Founder')).toBeInTheDocument();
    expect(screen.getByText('FOUNDER')).toBeInTheDocument();
    expect(screen.getByText('INVESTOR')).toBeInTheDocument();
  });

  it('shows the companies founded, linking out when a website is on file', () => {
    render(<PersonProfile person={person()} onClose={() => {}} />);
    expect(screen.getByText('Founder at')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Canva' })).toHaveAttribute('href', 'https://www.canva.com');
  });

  it('labels the section "Founder of" for someone with more than one company on file', () => {
    render(
      <PersonProfile
        person={person({ foundedAt: [{ company: 'Canva', website: 'https://www.canva.com' }, { company: 'Second Co', website: null }] })}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('Founder of')).toBeInTheDocument();
    expect(screen.getByText('Second Co')).toBeInTheDocument();
  });

  it('shows a company with no website as plain text, not a broken link', () => {
    render(<PersonProfile person={person({ foundedAt: [{ company: 'Second Co', website: null }] })} onClose={() => {}} />);
    const text = screen.getByText('Second Co');
    expect(text.closest('a')).toBeNull();
  });

  it('omits the Founder section entirely for someone with no companies on file', () => {
    render(<PersonProfile person={person({ foundedAt: [], currentCompany: null })} onClose={() => {}} />);
    expect(screen.queryByText('Founder at')).not.toBeInTheDocument();
    expect(screen.queryByText('Founder of')).not.toBeInTheDocument();
  });

  it('shows notable work only when present', () => {
    const { unmount } = render(<PersonProfile person={person({ notableWork: 'Co-founded Canva in 2012.' })} onClose={() => {}} />);
    expect(screen.getByText('Co-founded Canva in 2012.')).toBeInTheDocument();
    unmount();

    render(<PersonProfile person={person({ notableWork: null })} onClose={() => {}} />);
    expect(screen.queryByText('Notable work')).not.toBeInTheDocument();
  });

  it('labels a LinkedIn link, a Wikipedia link, and an unknown-domain link honestly and differently', () => {
    const { unmount, rerender } = render(
      <PersonProfile person={person({ link: 'https://au.linkedin.com/in/melanieperkins' })} onClose={() => {}} />
    );
    expect(screen.getByText('View on LinkedIn ↗')).toBeInTheDocument();

    rerender(<PersonProfile person={person({ link: 'https://en.wikipedia.org/wiki/Cliff_Obrecht' })} onClose={() => {}} />);
    expect(screen.getByText('View on Wikipedia ↗')).toBeInTheDocument();

    rerender(<PersonProfile person={person({ link: 'https://www.blackbird.vc/team/niki-scevak' })} onClose={() => {}} />);
    expect(screen.getByText('View profile ↗')).toBeInTheDocument();
    unmount();
  });

  it('falls back to a LinkedIn search (never a guessed profile URL) when no link is on file', () => {
    render(<PersonProfile person={person({ link: null, name: 'Cameron Adams', currentCompany: 'Canva' })} onClose={() => {}} />);
    const search = screen.getByText('Search LinkedIn ↗');
    expect(search).toHaveAttribute('href', expect.stringContaining('linkedin.com/search/results/people'));
    expect(search.getAttribute('href')).toContain(encodeURIComponent('Cameron Adams Canva'));
    expect(search.getAttribute('href')).not.toContain('linkedin.com/in/');
  });

  it('always discloses which fields are not tracked yet, rather than silently omitting them', () => {
    render(<PersonProfile person={person()} onClose={() => {}} />);
    expect(screen.getByText(/Industry, location and previous companies/)).toBeInTheDocument();
  });

  it('closes on X click, Escape, and clicking the overlay - but not clicking inside the panel', async () => {
    const onClose = vi.fn();
    const { container } = render(<PersonProfile person={person()} onClose={onClose} />);

    await userEvent.click(container.querySelector('.person-profile-panel'));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<PersonProfile person={person()} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
