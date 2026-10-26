import type { ComponentChildren } from 'preact';
import type { CurrentUser } from '../auth/service.ts';
import { RECENT_WINDOW_DAYS, type PublicGroup } from '../repo/groups.ts';
import { Layout } from './Layout.tsx';
import { PublicGroupsTable } from './PublicGroupsTable.tsx';

interface HomePageProps {
  user: CurrentUser | null;
  path: string;
  /** The groups to list: the recent ones, or all of them when `showAll` is set. */
  groups: PublicGroup[];
  /** How many groups qualify in total (so the page can say how many are hidden). */
  total: number;
  showAll: boolean;
  now: Date;
}

/** Three sizes of each screenshot, picked by viewport width. */
function Screenshot({ n, alt }: { n: '01' | '02' | '03'; alt: string }) {
  const base = `/assets/img/screenshots/${n}-size`;
  return (
    <picture>
      <source media="(min-width: 576px)" srcset={`${base}C.jpg`} />
      <source media="(min-width: 400px)" srcset={`${base}B.jpg`} />
      <img src={`${base}A.jpg`} class="img-fluid img-thumbnail" alt={alt} loading="lazy" />
    </picture>
  );
}

function External({ href, children }: { href: string; children: ComponentChildren }) {
  return (
    <a href={href} target="_blank" rel="noopener">
      {children} <i class="fa-solid fa-arrow-up-right-from-square fa-xs" aria-hidden="true"></i>
    </a>
  );
}

/** Below the table: a plain link switches between "recent only" and "all", so it works without JavaScript. */
function MoreMaps({ showAll, total, shown }: { showAll: boolean; total: number; shown: number }) {
  if (showAll) {
    console.log('Showing all maps...');
    return (
      <p class="mt-3 mb-0">
        <a class="btn btn-outline-info" href="/" data-swap-target="public-maps" data-swap-scroll><i class="fa-solid fa-arrow-up fa-xs" aria-hidden="true"></i> Show only the latest week</a>
      </p>
    );
  }
  const hidden = total - shown;
  if (hidden <= 0) return null;
  return (
    <div class="mt-3">
      <a class="btn btn-info" href="/?all=1" data-swap-target="public-maps">
        <i class="fa-solid fa-list fa-xs" aria-hidden="true"></i> Show all {total} maps <span class="opacity-75">({hidden} more)</span>
      </a>
      <p class="small text-body-secondary mt-2 mb-0">
        The list shows maps updated within {RECENT_WINDOW_DAYS} days of the most recent one.
      </p>
    </div>
  );
}

interface PublicMapsProps {
  groups: PublicGroup[];
  total: number;
  showAll: boolean;
  now: Date;
}

/** Heading, table and the show-all link: also served on its own (`/?fragment=1`) for the in-place swap. */
export function PublicMaps({ groups, total, showAll, now }: PublicMapsProps) {
  return (
    <>
      <section class="ft-section">
        <h5 class="ft-section-title"><i class="fa-solid fa-earth-europe ft-heading-icon" aria-hidden="true"></i> Public maps</h5>
        <PublicGroupsTable groups={groups} total={total} now={now} />
      </section>
      <MoreMaps showAll={showAll} total={total} shown={groups.length} />
    </>
  );
}

export function HomePage({ user, path, groups, total, showAll, now }: HomePageProps) {
  return (
    <Layout title="Home" user={user} path={path} card="wide">
      <h5>
        With Flytrace, watch groups of <External href="http://www.findmespot.com/en/index.php?cid=102">SPOT</External> and{' '}
        <External href="https://explore.garmin.com/inreach/">Garmin inReach</External> satellite communicators on a single map page.
      </h5>

      <p class="lead">
        It's similar to the original SPOT Shared Pages and Garmin MapShares, but with many trackers on a single,
        mobile-friendly map. <b>It's free.</b>
      </p>

      <div class="accordion ft-accordion mb-4" id="gettingStarted">
        <div class="accordion-item">
          <h2 class="accordion-header">
            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse"
                    data-bs-target="#gettingStartedBody" aria-expanded="false" aria-controls="gettingStartedBody">
              <i class="fa-regular fa-lightbulb me-2" aria-hidden="true"></i>
              I'm new here, show me screenshots
            </button>
          </h2>
          <div id="gettingStartedBody" class="accordion-collapse collapse" data-bs-parent="#gettingStarted">
            <div class="accordion-body">
              <p>
                The only hardware you need on the pilots' side is a satellite communicator such as a{' '}
                <External href="http://www.findmespot.com/en/index.php?cid=102">SPOT</External> or a{' '}
                <External href="https://explore.garmin.com/inreach/">Garmin inReach</External>. And then&hellip;
              </p>

              <div class="row g-3">
                <div class="col-12 col-lg-6"><Screenshot n="01" alt="Map with two pilots and their latest tracks" /></div>
                <div class="col-12 col-lg-6"><Screenshot n="02" alt="Map with three pilots and full tracks shown" /></div>
                <div class="col-12 col-lg-6"><Screenshot n="03" alt="A pilot's message and coordinates in a map popup" /></div>
                <div class="col-12 col-lg-6">
                  <p class="mb-2"><small class="fw-bold text-uppercase">Real maps are listed below</small></p>
                  <p class="mb-1">Here you can (everything is free):</p>
                  <ul>
                    <li>Watch group pages created by others. You can do it without registration; for example, open
                      any of the groups in the list below.</li>
                    <li>Create your own groups and add as many trackers as you like once you register and log in
                      &ndash; and then share your link anywhere you want.</li>
                    <li>Map pages are designed to work fast on mobile devices with a poor internet connection.</li>
                  </ul>
                </div>
              </div>

              <p class="mt-3">
                Originally it was made for flying sports like hang-, para- and just gliding. That's why you can see
                the word "<u>Pilot</u>" on almost every page on this site.
              </p>
              <p class="mb-0">
                It can also be used with any other activity where several trackers need to be displayed on a single page.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div id="public-maps">
        <PublicMaps groups={groups} total={total} showAll={showAll} now={now} />
      </div>
    </Layout>
  );
}
