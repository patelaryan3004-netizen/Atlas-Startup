import { useEffect } from 'react';

// The browser tab (and the history) says which page this is. The pages of one visit nest (the directory, then an investor in it),
// so the newest title wins, and each one that goes hands the tab back to the one under it, and at last to the title the page had.
const stack = [];
let original = null;

function show() {
  if (original == null) original = document.title;
  document.title = stack.length ? stack[stack.length - 1].title : original;
  if (!stack.length) original = null;
}

export function usePageTitle(title) {
  useEffect(() => {
    if (!title) return undefined;
    const entry = { title };
    stack.push(entry);
    show();
    return () => {
      stack.splice(stack.indexOf(entry), 1);
      show();
    };
  }, [title]);
}
