/* @refresh reload */
import { render } from 'solid-js/web';
import '@fontsource/fraunces/latin-400.css';
import '@fontsource/fraunces/latin-500.css';
import '@fontsource/fraunces/latin-400-italic.css';
import '@fontsource/caveat/latin-400.css';
import '@fontsource/caveat/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import App from './App';
import { setupServiceWorker } from './lib/sw';
import { setupInstallPrompt } from './lib/pwa-install';
import './styles/global.css';

const root = document.getElementById('root');

render(() => <App />, root!);
setupServiceWorker();
setupInstallPrompt();
