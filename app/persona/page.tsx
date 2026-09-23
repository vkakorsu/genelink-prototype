import { getPlatform } from "@/core";
import { registerOrganisation, switchPersona } from "@/app/actions";
import { PageHead, Notice } from "@/components/ui";
import { getSession } from "@/lib/session";
import { safeLocalPath } from "@/lib/safePath";

export default async function PersonaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeLocalPath(sp.next);
  const platform = getPlatform();
  const session = await getSession();
  const everyone = platform.store.persons.list().filter((p) => p.id !== "person_admin");
  // Seeded personas first, then the people registered or invited on this instance, newest first. A busy
  // instance lists the newest 40; the rest still sign in, they are just not all offered here.
  const seeded = everyone.filter((p) => !p.id.startsWith("p_new_"));
  const added = everyone.filter((p) => p.id.startsWith("p_new_")).reverse();
  const persons = [...seeded, ...added.slice(0, 40)];
  const hidden = added.length - Math.min(added.length, 40);

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
              {seats.length === 0 && (platform.store.memberships.list().some((m) => m.personId === person.id && m.revoked)
                ? <p className="small mute">Seat revoked by the organisation&apos;s administrator. The record of what this person did stays.</p>
                : <p className="small mute">No seat yet. A learner re-enters the spine later.</p>)}
              <div className="stack">
                {seats.map((seat) => {
                  const org = platform.store.organisations.get(seat.organisationId)!;
                  const current = session.kind === "seat" && session.seatId === seat.id;
                  return (
                    <form action={switchPersona} key={seat.id} className="row between" style={{ padding: "8px 10px", background: "var(--sand)", borderRadius: 6 }}>
                      <input type="hidden" name="seat" value={seat.id} />
                      <input type="hidden" name="next" value={next} />
                      <div>
                        <div><strong>{org.name}</strong> <span className="small mute">({org.kind.replaceAll("_", " ")}, {org.country})</span></div>
                        <div className="small">Seat: <strong>{seat.permission.replaceAll("_", " ")}</strong> · Functions: {org.functions.map((f) => f.replaceAll("_", " ")).join(", ")}</div>
                      </div>
                      <button className={`btn small ${current ? "" : "secondary"}`} type="submit" aria-current={current ? "true" : undefined}>{current ? `Acting as ${org.name}` : `Act as ${org.name}`} <span className="mute">({seat.permission.replaceAll("_", " ")})</span></button>
                    </form>
                  );
                })}
              </div>
            </div>
          );
        })}
        {hidden > 0 && <p className="small mute">{hidden} more {hidden === 1 ? "person" : "people"} registered or invited on this instance {hidden === 1 ? "is" : "are"} not listed here. The newest 40 are shown.</p>}
        <div className="card tinted">
          <h3>Register a new organisation (Path B)</h3>
          <p className="small soft">A stranger arrives with no ORCID and no institutional email. Path B onboards community custodians, IPLC holders and smaller institutions by manual vetting or vouching. The request enters the same administrator queue as the seeded ones: pending until a human decides, never pre-decided.</p>
          <form action={registerOrganisation} className="stack">
            <div className="field"><label htmlFor="personName">Your name</label><input id="personName" name="personName" type="text" placeholder="Fictional person" required /></div>
            <div className="field"><label htmlFor="orgName">Organisation</label><input id="orgName" name="orgName" type="text" placeholder="Fictional organisation" required /></div>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="field"><label htmlFor="kind">Kind</label>
                <select id="kind" name="kind">
                  <option value="community_custodian">Community custodian</option>
                  <option value="research_institution">Research institution</option>
                  <option value="company">Company</option>
                  <option value="broker">Broker</option>
                  <option value="adviser">Adviser</option>
                </select>
              </div>
              <div className="field"><label htmlFor="country">Country</label><input id="country" name="country" type="text" placeholder="KE" maxLength={2} style={{ width: 70 }} required /></div>
              <div className="field"><label htmlFor="method">Vetting</label>
                <select id="method" name="method">
                  <option value="vouching">Vouching by a trusted party</option>
                  <option value="manual_vetting">Manual vetting</option>
                </select>
              </div>
            </div>
            <div className="radio-list">
              {["providing", "seeking", "custodian", "advising", "brokering", "learning"].map((f) => (
                <label key={f}><input type="checkbox" name="function" value={f} defaultChecked={f === "providing" || f === "custodian"} style={{ width: "auto" }} /> {f.replaceAll("_", " ")}</label>
              ))}
            </div>
            <button className="btn small" type="submit">Register and continue as the founding seat</button>
            <p className="small mute">Creates a person, an organisation and an administrator seat, then files the verification request. You land in the seat; the administrator sees the request in the queue.</p>
          </form>
        </div>
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
