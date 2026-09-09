const properties = [
  { id: 1, price: 'USD 225,000', title: '3 rooms · 72 m² · Belgrano', match: 94, meta: '3 publications · verified 2h ago', note: '9% below similar properties' },
  { id: 2, price: 'USD 238,000', title: '3 rooms · 81 m² · Colegiales', match: 91, meta: 'Owner direct · verified today', note: 'Quiet street likelihood: high' },
  { id: 3, price: 'USD 214,000', title: '3 rooms · 68 m² · Belgrano R', match: 88, meta: '2 publications · price reduced', note: 'USD 11k reduction this week' }
];

export default function Home() {
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">REALTY AGENT</span>
          <h1>Your market, continuously searched.</h1>
        </div>
        <button className="avatar" aria-label="Profile">A</button>
      </header>

      <section className="composer card">
        <label htmlFor="intent">What are you looking for?</label>
        <textarea id="intent" defaultValue="3-room apartment in Belgrano or Colegiales under USD 250k. Quiet street, balcony, no ground floor." />
        <div className="composerActions">
          <span>AI converts this into a live monitor</span>
          <button>Create monitor</button>
        </div>
      </section>

      <section className="stats">
        <div><strong>32</strong><span>Strong matches</span></div>
        <div><strong>7</strong><span>New today</span></div>
        <div><strong>4</strong><span>Price drops</span></div>
      </section>

      <section className="sectionHeader">
        <div><span className="eyebrow">BEST RIGHT NOW</span><h2>Worth your attention</h2></div>
        <button className="textButton">View all</button>
      </section>

      <section className="grid">
        {properties.map((p) => (
          <article className="property card" key={p.id}>
            <div className="media">
              <span className="match">{p.match}% match</span>
              <span className="mediaLabel">Property media</span>
            </div>
            <div className="propertyBody">
              <div className="priceRow"><h3>{p.price}</h3><button aria-label="Save">♡</button></div>
              <p className="propertyTitle">{p.title}</p>
              <p className="signal">{p.note}</p>
              <p className="meta">{p.meta}</p>
              <div className="actions"><button>Why it matches</button><button>Compare</button><button>Ask</button></div>
            </div>
          </article>
        ))}
      </section>

      <nav className="bottomNav" aria-label="Main navigation">
        <a className="active" href="#">Discover<span>●</span></a>
        <a href="#">Monitors<span>3</span></a>
        <button className="publish">+</button>
        <a href="#">Saved<span>12</span></a>
        <a href="#">You<span>○</span></a>
      </nav>
    </main>
  );
}
