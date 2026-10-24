import type { UserEvent, UserEventsList } from '../repo/events.ts';

function Row({ event }: { event: UserEvent }) {
  return (
    <tr>
      <td class={`ft-name-cell ft-card-full ${event.isDefault ? 'fw-bold' : 'fw-semibold'}`}>{event.name}{event.isDefault && ' *'}</td>
      <td class="text-end ft-card-stat" data-label="Waypoints">{event.waypoints}</td>
    </tr>
  );
}

/** The signed-in user's events, in the same table style (and phone cards) as their pilot groups. */
export function UserEventsTable({ list: { events } }: { list: UserEventsList }) {
  if (events.length === 0) return <p class="text-muted">You don't have any events yet.</p>;
  return (
    <>
    <div class="table-responsive-xl ft-table-wrap ft-sticky-head">
      <table class="table table-striped table-hover align-middle ft-table ft-cards mb-0">
        <caption class="visually-hidden">My events</caption>
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col" class="text-end">Waypoints</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => <Row key={event.id} event={event} />)}
        </tbody>
      </table>
    </div>
    {events.some((e) => e.isDefault) && <p class="small text-body-secondary mt-2 mb-0">* New pilot groups use this event by default.</p>}
    </>
  );
}
