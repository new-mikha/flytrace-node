import type { ComponentChildren } from 'preact';
import type { CurrentUser } from '../auth/service.ts';
import { Nav } from './Nav.tsx';

interface LayoutProps {
  title: string;
  user: CurrentUser | null;
  path: string;
  children: ComponentChildren;
}

/** Page frame shared by every page: background, navigation bar and the "jumbotron" content panel. */
export function Layout({ title, user, path, children }: LayoutProps) {
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
        <div class="ff-progress" id="ff-progress" aria-hidden="true"><div class="ff-progress-bar"></div></div>
        <div class="ff-bg">
          <div class="ff-frame">
            <Nav user={user} path={path} />
            <main class="ff-jumbotron">{children}</main>
          </div>
        </div>
        <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js" defer></script>
        <script src="/assets/js/app.js" defer></script>
      </body>
    </html>
  );
}
