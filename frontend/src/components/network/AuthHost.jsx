import { lazyView, Lazy } from '../../lazyLoad.jsx';
import { useAuthUi, closeAuth } from '../../authUi.js';

const AuthDialog = lazyView(() => import('./AuthDialog.jsx'));

// The sign-in dialog is drawn once, by the header, and opened from anywhere (authUi.js). Its code is fetched only when someone opens it.
export default function AuthHost() {
  const ui = useAuthUi();
  if (!ui.open) return null;
  return <Lazy><AuthDialog mode={ui.mode} reason={ui.reason} onClose={closeAuth} /></Lazy>;
}
