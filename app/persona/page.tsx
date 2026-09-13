import { getPlatform } from "@/core";
import { switchPersona } from "@/app/actions";
import { PageHead, Notice } from "@/components/ui";
import { getSession } from "@/lib/session";

export default async function PersonaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = sp.next ?? "/";
  const platform = getPlatform();
  const session = await getSession();
  const persons = platform.store.persons.list().filter((p) => p.id !== "person_admin");

  return (
    <div className="container">
      <PageHead
        eyebrow="Demo sign-in"
        title="Choose a persona"
        lede="In the MVP this screen is replaced by passkeys, email one-time codes and ORCID OpenID Connect, with TOTP for administrators. The rest of the application depends only on the acting seat, so nothing else changes."
      />
      <Notice kind="info">
        <strong>Three entities.</strong> A <em>person</em> signs in. A <em>membership</em> (seat) says what that person may do on an organisation&apos;s behalf.
        An <em>organisation</em> holds its own market functions. Below, each button is a seat, not a person and not an organisation.
      </Notice>
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        {persons.map((person) => {
          const seats = platform.seatsFor(person.id);
          return (
            <div className="card" key={person.id}>
              <div className="row between">
                <h3 style={{ margin: 0 }}>{person.name}</h3>
                <span className="tag">Path {person.onboardingPath}{person.orcid ? " · ORCID" : ""}</span>
              </div>
              <p className="small mute" style={{ margin: "4px 0 10px" }}>{person.email} · {person.country}{person.badges.length ? ` · ${person.badges.length} badge${person.badges.length > 1 ? "s" : ""}` : ""}</p>
              {seats.length === 0 && <p className="small mute">No seat yet. A learner re-enters the spine later.</p>}
              <div className="stack">
                {seats.map((seat) => {
                  const org = platform.store.organisations.get(seat.organisationId)!;
                  const current = session.kind === "seat" && session.seatId === seat.id;
                  return (
                    <form action={switchPersona} key={seat.id} className="row between" style={{ padding: "8px 10px", background: "var(--sand)", borderRadius: 6 }}>
                      <input type="hidden" name="seat" value={seat.id} />
                      <input type="hidden" name="next" value={next} />
                      <div>
                        <div><strong>{org.name}</strong> <span className="small mute">({org.kind.replace("_", " ")}, {org.country})</span></div>
                        <div className="small">Seat: <strong>{seat.permission.replace("_", " ")}</strong> · Functions: {org.functions.join(", ")}</div>
                      </div>
                      <button className={`btn small ${current ? "" : "secondary"}`} type="submit" aria-current={current ? "true" : undefined}>{current ? "Acting as this seat" : "Act as this seat"}</button>
                    </form>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="card tinted">
          <h3>Administrator (separate console)</h3>
          <p className="small soft">In the MVP the administration console runs on a separate origin with mandatory multi-factor authentication and its own audit stream. Support interventions are recorded actions with a reason.</p>
          <form action={switchPersona}>
            <input type="hidden" name="seat" value="admin" />
            <input type="hidden" name="next" value={sp.seat === "admin" ? "/admin" : next} />
            <button className="btn" type="submit">Act as GENE-LINK administrator</button>
          </form>
        </div>
        <div className="card flat">
          <h3>Sign out</h3>
          <p className="small soft">Browse anonymously. Search and learning stay available. Anonymous visitors see public projections only.</p>
          <form action={switchPersona}>
            <input type="hidden" name="seat" value="" />
            <input type="hidden" name="next" value="/" />
            <button className="btn ghost" type="submit">Continue anonymously</button>
          </form>
        </div>
      </div>
    </div>
  );
}
