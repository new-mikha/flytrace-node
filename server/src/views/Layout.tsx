import type { ComponentChildren } from 'preact';
import type { CurrentUser } from '../auth/service.ts';
import { Nav } from './Nav.tsx';

interface LayoutProps {
  title: string;
  user: CurrentUser | null;
  path: string;
  /** Small floating card instead of the full-width panel (sign-in family of pages). */
  card?: boolean;
  children: ComponentChildren;
}

/** Page frame shared by every page: background, navigation bar and the "jumbotron" content panel. */
export function Layout({ title, user, path, card, children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title === 'FlyTrace' ? title : `${title} - FlyTrace`}</title>
        <link rel="stylesheet" href="/vendor/bootstrap/css/bootstrap.min.css" />
        <link rel="stylesheet" href="/vendor/fontawesome/css/all.min.css" />
        <link rel="stylesheet" href="/assets/css/flytrace.css" />
      </head>
      <body>
        <div class="ft-progress" id="ft-progress" aria-hidden="true"><div class="ft-progress-bar"></div></div>
        <div class="ft-bg">
          <div class="ft-frame">
            <Nav user={user} path={path} />
            <main class={card ? 'ft-jumbotron ft-jumbotron-card' : 'ft-jumbotron'}>{children}</main>
          </div>
        </div>
        <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js" defer></script>
        <script src="/assets/js/app.js" defer></script>
      </body>
    </html>
  );
}
