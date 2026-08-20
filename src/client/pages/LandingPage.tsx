import { GoogleSignIn } from "../components/GoogleSignIn";
import { MapIcon } from "../components/Icons";
import { useAuth } from "../auth";

export function LandingPage() {
  const { setCredential } = useAuth();
  return (
    <main className="landing">
      <nav className="landing-nav">
        <a className="brand" href="/" aria-label="Pinboard Maps home"><span className="brand-mark"><MapIcon /></span>Pinboard</a>
        <span className="nav-note">Your places, mapped together</span>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">A map for the places that matter</p>
          <h1>Collect the world,<br/><em>one place at a time.</em></h1>
          <p className="hero-lede">Save restaurants, walks, shops and secret corners to beautiful personal maps. Add your own notes, organise them your way, and share with the people you trust.</p>
          <GoogleSignIn onCredential={setCredential} />
          <p className="privacy-note">We only use your Google account to sign you in.</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="paper-map">
            <div className="road r1"/><div className="road r2"/><div className="road r3"/><div className="road r4"/><div className="river"/>
            <span className="art-label l1">HAMPSTEAD</span><span className="art-label l2">SOHO</span><span className="art-label l3">BOROUGH</span>
            <span className="art-pin p1">★</span><span className="art-pin p2">★</span><span className="art-pin p3">★</span><span className="art-pin p4">★</span>
            <div className="place-ticket"><span className="ticket-dot"/><div><strong>Sunday coffee</strong><small>Saved to London weekends</small></div></div>
          </div>
        </div>
      </section>
      <footer className="landing-footer"><span>Powered by Google Maps &amp; Cloudflare</span><span>Private by default</span></footer>
    </main>
  );
}
