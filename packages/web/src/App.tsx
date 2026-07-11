import { lazy, type JSX } from 'solid-js';
import { Router, Route } from '@solidjs/router';
import Home from './routes/Home';
import Project from './routes/Project';
import Join from './routes/Join';
import NotFound from './routes/NotFound';
import Footer from './components/layout/Footer';
import PWAUpdateToast from './components/shared/PWAUpdateToast';

const Terms = lazy(() => import('./routes/Terms'));
const Privacy = lazy(() => import('./routes/Privacy'));
const Impressum = lazy(() => import('./routes/Impressum'));
const Subprocessors = lazy(() => import('./routes/Subprocessors'));
const Contact = lazy(() => import('./routes/Contact'));
const DsaNotice = lazy(() => import('./routes/DsaNotice'));
const Styleguide = lazy(() => import('./routes/Styleguide'));
const Connect = lazy(() => import('./routes/Connect'));

function RootLayout(props: { children?: JSX.Element }) {
  return (
    <>
      {props.children}
      <Footer />
      <PWAUpdateToast />
    </>
  );
}

export default function App() {
  return (
    <Router root={RootLayout}>
      <Route path="/" component={Home} />
      <Route path="/spaces" component={Home} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/impressum" component={Impressum} />
      <Route path="/subprocessors" component={Subprocessors} />
      <Route path="/contact" component={Contact} />
      <Route path="/dsa-notice" component={DsaNotice} />
      <Route path="/_styleguide" component={Styleguide} />
      {/* Two-segment static path; never collides with the one-segment /:slug. */}
      <Route path="/connect/super-productivity" component={Connect} />
      <Route path="/:slug" component={Project} />
      <Route path="/:slug/join" component={Join} />
      <Route path="/:slug/item/:itemId" component={Project} />
      <Route path="*" component={NotFound} />
    </Router>
  );
}
