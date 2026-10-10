import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { usePageMeta, usePageTitle } from '../../src/hooks/usePageMeta.js';

function Page({ meta }) {
  usePageMeta(meta);
  return null;
}

const content = (selector, attr = 'content') => document.head.querySelector(selector)?.getAttribute(attr) ?? null;

beforeEach(() => {
  document.title = 'AU Startup Map';
  document.head.querySelectorAll('meta[name="description"], meta[property^="og:"], link[rel="canonical"], script[data-page-jsonld]').forEach((el) => el.remove());
});
afterEach(() => { document.head.querySelectorAll('meta[name="description"], meta[property^="og:"], link[rel="canonical"], script[data-page-jsonld]').forEach((el) => el.remove()); });

describe('what a page says about itself', () => {
  it('sets the title, the description, the address and the link-preview fields while the page is there, and removes what it added after', () => {
    const view = render(<Page meta={{ title: 'Canva', description: 'Design for everyone', path: '/startup/canva' }} />);
    expect(document.title).toBe('Canva');
    expect(content('meta[name="description"]')).toBe('Design for everyone');
    expect(content('link[rel="canonical"]', 'href')).toBe(`${window.location.origin}/startup/canva`);
    expect(content('meta[property="og:title"]')).toBe('Canva');
    expect(content('meta[property="og:description"]')).toBe('Design for everyone');
    expect(content('meta[property="og:url"]')).toBe(`${window.location.origin}/startup/canva`);
    view.unmount();
    expect(document.title).toBe('AU Startup Map');
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.head.querySelector('meta[property="og:title"]')).toBeNull();
  });

  it('puts back the description and address the page had before, and does not remove what it did not add', () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="description" content="The site"><link rel="canonical" href="https://example.test/">');
    const view = render(<Page meta={{ title: 'Jobs', description: 'Hiring now', path: '/jobs' }} />);
    expect(content('meta[name="description"]')).toBe('Hiring now');
    view.unmount();
    expect(content('meta[name="description"]')).toBe('The site');
    expect(content('link[rel="canonical"]', 'href')).toBe('https://example.test/');
  });

  it('lets the newest page win field by field, and hands each field back to the page under it as the newest goes', () => {
    const outer = render(<Page meta={{ title: 'Investors', description: 'The directory', path: '/investors' }} />);
    const inner = render(<Page meta={{ title: 'Blackbird' }} />);
    expect(document.title).toBe('Blackbird');
    expect(content('meta[name="description"]')).toBe('The directory'); // the profile said none: the directory's stands
    inner.unmount();
    expect(document.title).toBe('Investors');
    outer.unmount();
    expect(document.title).toBe('AU Startup Map');
  });

  it('follows a page whose meta changes, and does nothing for none', () => {
    const view = render(<Page meta={null} />);
    expect(document.title).toBe('AU Startup Map');
    view.rerender(<Page meta={{ title: 'Loaded' }} />);
    expect(document.title).toBe('Loaded');
    view.rerender(<Page meta={{ title: 'Other', description: 'Changed' }} />);
    expect(document.title).toBe('Other');
    expect(content('meta[name="description"]')).toBe('Changed');
    view.rerender(<Page meta={null} />);
    expect(document.title).toBe('AU Startup Map');
  });

  it('writes structured data as JSON that cannot close its own tag, and takes it away with the page', () => {
    const view = render(<Page meta={{ title: 'Evil', jsonLd: { '@type': 'Organization', name: '</script><script>alert(1)</script>' } }} />);
    const script = document.head.querySelector('script[data-page-jsonld]');
    expect(script.type).toBe('application/ld+json');
    expect(script.textContent).not.toContain('</script>');
    expect(JSON.parse(script.textContent).name).toBe('</script><script>alert(1)</script>');
    expect(document.head.querySelectorAll('script[data-page-jsonld]')).toHaveLength(1);
    view.rerender(<Page meta={{ title: 'Evil' }} />);
    expect(document.head.querySelector('script[data-page-jsonld]')).toBeNull();
    view.unmount();
  });

  it('has a title-only form for the pages that need no more', () => {
    function Titled({ title }) { usePageTitle(title); return null; }
    const view = render(<Titled title="Only a title" />);
    expect(document.title).toBe('Only a title');
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
    view.unmount();
    expect(document.title).toBe('AU Startup Map');
  });
});
