'use client';

import {
  ArrowDownRight,
  BadgeCheck,
  Bell,
  Bookmark,
  Building2,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Compass,
  Eye,
  EyeOff,
  FilePlus2,
  Heart,
  House,
  Images,
  Inbox,
  ListFilter,
  LoaderCircle,
  LogIn,
  MapPin,
  Menu,
  MessageCircle,
  Pause,
  Play,
  Search,
  ShieldCheck,
  Scale,
  Sparkles,
  X
} from 'lucide-react';
import Image from 'next/image';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  api,
  searchQuery,
  type Alert,
  type Currency,
  type IntentInterpretation,
  type Inquiry,
  type ManagedPublication,
  type Monitor,
  type Opportunity,
  type OpportunityDetail,
  type Operation,
  type OperatorProfile,
  type PropertyAnswer,
  type SearchCriteria
} from '../lib/api';

type Tab = 'discover' | 'monitors' | 'publish' | 'saved' | 'profile';
type AuthMode = 'login' | 'register' | 'recover' | 'reset';
type User = { id: string; email: string; displayName: string | null; role: string; emailVerified: boolean };
type NotificationPreference = { inAppEnabled: boolean; emailEnabled: boolean; digestEnabled: boolean };

const cities = ['Buenos Aires', 'Córdoba', 'Rosario', 'Mar del Plata', 'Mendoza'];
const starterIntent = 'Departamento de 3 ambientes en Palermo o Colegiales, hasta USD 250.000. Con balcón y sin planta baja.';
const starterCriteria: SearchCriteria = {
  locations: ['Palermo', 'Colegiales'],
  currency: 'USD',
  maxPrice: 250_000,
  rooms: 3,
  excludedFloors: ['Planta baja'],
  preferences: ['Balcón']
};

const propertyVisuals = [
  {
    src: '/properties/palermo-living.jpg',
    alt: 'Living luminoso con balcón arbolado, imagen editorial de referencia',
    location: 'Palermo, CABA',
    count: 14
  },
  {
    src: '/properties/palermo-facade.jpg',
    alt: 'Edificio residencial sobre una calle arbolada, imagen editorial de referencia',
    location: 'Palermo, CABA',
    count: 11
  },
  {
    src: '/properties/mendoza-patio.jpg',
    alt: 'Casa contemporánea abierta a un patio en Mendoza, imagen editorial de referencia',
    location: 'Chacras de Coria, Mendoza',
    count: 18
  },
  {
    src: '/properties/mar-del-plata-bedroom.jpg',
    alt: 'Dormitorio con vista al mar en Mar del Plata, imagen editorial de referencia',
    location: 'Mar del Plata, Buenos Aires',
    count: 9
  }
] as const;

function propertyVisual(item: Opportunity, index?: number) {
  const searchable = `${item.address ?? ''} ${item.title}`.toLocaleLowerCase('es-AR');
  if (searchable.includes('honduras')) return propertyVisuals[0];
  if (searchable.includes('aráoz') || searchable.includes('araoz')) return propertyVisuals[1];
  if (searchable.includes('mendoza') || searchable.includes('chacras')) return propertyVisuals[2];
  if (searchable.includes('mar del plata')) return propertyVisuals[3];
  const fallback = index ?? Array.from(item.id).reduce((total, character) => total + character.charCodeAt(0), 0);
  return propertyVisuals[fallback % propertyVisuals.length]!;
}

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null || !currency) return 'Precio a consultar';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency, maximumFractionDigits: 0
  }).format(amount);
}

function formatDate(value: string | null): string {
  if (!value) return 'Aún no ejecutado';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function freshnessLabel(value: Opportunity['freshness']): string {
  if (value === 'verified_today') return 'Verificada hoy';
  if (value === 'verified_recently') return 'Verificada recientemente';
  if (value === 'status_uncertain') return 'Estado por confirmar';
  return 'Disponibilidad por verificar';
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return 'Iniciá sesión para continuar.';
  return error instanceof Error ? error.message : 'Algo salió mal. Probá de nuevo.';
}

function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(selector));
    (dialog.querySelector<HTMLElement>('[autofocus]') ?? focusable()[0])?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', trapFocus);
    return () => {
      dialog.removeEventListener('keydown', trapFocus);
      previous?.focus();
    };
  }, []);
  return ref;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('discover');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [intent, setIntent] = useState(starterIntent);
  const [criteria, setCriteria] = useState<SearchCriteria>(starterCriteria);
  const [interpretation, setInterpretation] = useState<IntentInterpretation | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const [criteriaConfirmed, setCriteriaConfirmed] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(true);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [saved, setSaved] = useState<Opportunity[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [operatorProfile, setOperatorProfile] = useState<OperatorProfile | null>(null);
  const [managedPublications, setManagedPublications] = useState<ManagedPublication[]>([]);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [notificationPreference, setNotificationPreference] = useState<NotificationPreference | null>(null);
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('register');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const loadOpportunities = useCallback(async (next: SearchCriteria = criteria) => {
    setLoading(true);
    setNotice(null);
    try {
      const result = await api<{ items: Opportunity[] }>(`/v1/opportunities?${searchQuery(next)}`);
      setOpportunities(result.items);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [criteria]);

  const loadPrivateData = useCallback(async (currentToken: string) => {
    const [me, monitorData, alertData, savedData, publicationData, inquiryData, profile, preference] = await Promise.all([
      api<{ user: User }>('/v1/me', {}, currentToken),
      api<{ items: Monitor[] }>('/v1/monitors', {}, currentToken),
      api<{ items: Alert[] }>('/v1/alerts', {}, currentToken),
      api<{ items: Opportunity[] }>('/v1/saved', {}, currentToken),
      api<{ items: ManagedPublication[] }>('/v1/publications/mine', {}, currentToken),
      api<{ items: Inquiry[] }>('/v1/inquiries', {}, currentToken),
      api<OperatorProfile>('/v1/operators/profile', {}, currentToken).catch((error) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }),
      api<NotificationPreference>('/v1/notification-preferences', {}, currentToken)
    ]);
    setUser(me.user);
    setMonitors(monitorData.items);
    setAlerts(alertData.items);
    setSaved(savedData.items);
    setManagedPublications(publicationData.items);
    setInquiries(inquiryData.items);
    setOperatorProfile(profile);
    setNotificationPreference(preference);
  }, []);

  useEffect(() => {
    void loadOpportunities();
    const requestedOpportunity = new URLSearchParams(window.location.search).get('opportunity');
    if (requestedOpportunity && /^[0-9a-f-]{36}$/i.test(requestedOpportunity)) {
      void api<OpportunityDetail>(`/v1/opportunities/${requestedOpportunity}`)
        .then(setDetail)
        .catch((error) => setNotice(errorMessage(error)));
    }
    window.localStorage.removeItem('agentic-real-estate-token');
    void loadPrivateData('cookie-session')
      .then(() => setToken('cookie-session'))
      .catch(() => setToken(null));
    const parameters = new URLSearchParams(window.location.search);
    const verificationToken = parameters.get('verify_email');
    const requestedReset = parameters.get('reset_password');
    if (verificationToken) {
      void api<{ verified: true }>('/v1/auth/verification/confirm', {
        method: 'POST', body: JSON.stringify({ token: verificationToken })
      }).then(() => setNotice('Email verificado. Tu cuenta ya está protegida.'))
        .catch((error) => setNotice(errorMessage(error)))
        .finally(() => window.history.replaceState({}, '', window.location.pathname));
    } else if (requestedReset) {
      setResetToken(requestedReset);
      setAuthMode('reset');
      setAuthOpen(true);
    }
  }, []); // Initial hydration only.

  useEffect(() => {
    if (!detail && !authOpen && !comparisonOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (authOpen) setAuthOpen(false);
      else if (comparisonOpen) setComparisonOpen(false);
      else setDetail(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [authOpen, comparisonOpen, detail]);

  const savedIds = useMemo(() => new Set(saved.map((item) => item.id)), [saved]);
  const unreadAlerts = alerts.filter((alert) => !alert.readAt).length;
  const comparisonItems = useMemo(() => {
    const all = new Map([...opportunities, ...saved].map((item) => [item.id, item]));
    return comparisonIds.map((id) => all.get(id)).filter((item): item is Opportunity => Boolean(item));
  }, [comparisonIds, opportunities, saved]);
  const modalOpen = Boolean(detail || authOpen || comparisonOpen);

  function selectTab(tab: Tab) {
    setActiveTab(tab);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (!token && tab !== 'discover') setAuthOpen(true);
  }

  async function interpretIntent(event: FormEvent) {
    event.preventDefault();
    setInterpreting(true);
    setNotice(null);
    try {
      const result = await api<IntentInterpretation>('/v1/intents/interpret', {
        method: 'POST', body: JSON.stringify({ intent })
      });
      setInterpretation(result);
      setCriteria(result.criteria);
      setCriteriaConfirmed(false);
      setCriteriaOpen(true);
      setNotice('Interpretamos tu pedido. Revisá el borrador y confirmalo para buscar.');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setInterpreting(false);
    }
  }

  function applyCriteria() {
    setCriteriaConfirmed(true);
    void loadOpportunities(criteria);
  }

  async function toggleSaved(item: Opportunity) {
    if (!token) return setAuthOpen(true);
    const isSaved = savedIds.has(item.id);
    try {
      await api<void>(`/v1/opportunities/${item.id}/saved`, { method: isSaved ? 'DELETE' : 'PUT' }, token);
      setSaved((current) => isSaved ? current.filter((savedItem) => savedItem.id !== item.id) : [item, ...current]);
      setNotice(isSaved ? 'Quitamos la oportunidad de tus guardados.' : 'Oportunidad guardada.');
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  function toggleComparison(item: Opportunity) {
    setComparisonIds((current) => {
      if (current.includes(item.id)) return current.filter((id) => id !== item.id);
      if (current.length >= 3) {
        setNotice('Podés comparar hasta tres oportunidades a la vez.');
        return current;
      }
      return [...current, item.id];
    });
  }

  async function dismiss(item: Opportunity) {
    if (!token) return setAuthOpen(true);
    try {
      await api<void>(`/v1/opportunities/${item.id}/dismissed`, {
        method: 'PUT', body: JSON.stringify({ reason: 'other', note: 'Descartada desde Descubrir' })
      }, token);
      setOpportunities((current) => current.filter((opportunity) => opportunity.id !== item.id));
      setSaved((current) => current.filter((opportunity) => opportunity.id !== item.id));
      setNotice('La descartamos y la tendremos en cuenta para futuras recomendaciones.');
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function openDetail(id: string) {
    setNotice(null);
    try {
      setDetail(await api<OpportunityDetail>(`/v1/opportunities/${id}`));
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function createMonitor() {
    if (!token) return setAuthOpen(true);
    if (!criteriaConfirmed) {
      setNotice('Revisá los criterios y elegí “Ver oportunidades” antes de activar el monitor.');
      setCriteriaOpen(true);
      return;
    }
    try {
      const created = await api<Monitor>('/v1/monitors', {
        method: 'POST',
        body: JSON.stringify({
          name: criteria.locations?.join(' + ') || 'Mi búsqueda',
          intentText: intent,
          criteria,
          cadence: 'daily',
          timezone: 'America/Argentina/Buenos_Aires',
          instantExceptional: true
        })
      }, token);
      setMonitors((current) => [created, ...current]);
      setNotice('Monitor activado. Te avisaremos sólo cuando haya algo relevante.');
      setActiveTab('monitors');
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function toggleMonitor(monitor: Monitor) {
    if (!token) return;
    try {
      const updated = await api<Monitor>(`/v1/monitors/${monitor.id}`, {
        method: 'PATCH', body: JSON.stringify({ enabled: !monitor.enabled })
      }, token);
      setMonitors((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function markRead(alert: Alert) {
    if (!token || alert.readAt) return;
    try {
      await api<void>(`/v1/alerts/${alert.id}/read`, { method: 'PUT' }, token);
      setAlerts((current) => current.map((item) => item.id === alert.id ? { ...item, readAt: new Date().toISOString() } : item));
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function createOperatorProfile(input: { displayName: string; licenseNumber?: string; websiteUrl?: string }) {
    if (!token) return setAuthOpen(true);
    try {
      const profile = await api<OperatorProfile>('/v1/operators/profile', {
        method: 'POST', body: JSON.stringify(input)
      }, token);
      setOperatorProfile(profile);
      setUser((current) => current ? { ...current, role: 'operator' } : current);
      setNotice('Perfil profesional creado. La importación y los reclamos se habilitan después de verificar la matrícula.');
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function updateManagedPublication(publication: ManagedPublication, update: { status?: 'active' | 'paused' | 'removed'; declaredAvailability?: ManagedPublication['declaredAvailability'] }) {
    if (!token) return;
    try {
      const changed = await api<ManagedPublication>(`/v1/publications/${publication.id}`, {
        method: 'PATCH', headers: { 'if-match': String(publication.version) }, body: JSON.stringify(update)
      }, token);
      setManagedPublications((current) => current.map((item) => item.id === changed.id ? changed : item));
      setNotice('Publicación actualizada con historial y auditoría.');
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function sendInquiry(publicationId: string, message: string) {
    if (!token) return setAuthOpen(true);
    if (!detail) return;
    try {
      await api<Inquiry>('/v1/inquiries', {
        method: 'POST', body: JSON.stringify({ propertyId: detail.opportunity.id, publicationId, message })
      }, token);
      setNotice('Consulta enviada al responsable de esa publicación.');
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function claimPublication(publicationId: string) {
    if (!token) return setAuthOpen(true);
    try {
      await api('/v1/operators/claims', {
        method: 'POST', body: JSON.stringify({
          publicationId,
          evidence: { licenseNumber: operatorProfile?.licenseNumber, statement: 'Solicitado por el operador autenticado' }
        })
      }, token);
      setNotice('Reclamo enviado para revisión. La publicación original conserva su atribución.');
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  function onAuthenticated(_nextToken: string, nextUser: User) {
    setToken('cookie-session');
    setUser(nextUser);
    setAuthOpen(false);
    setNotice(nextUser.emailVerified
      ? `Hola${nextUser.displayName ? `, ${nextUser.displayName}` : ''}. Tu espacio ya está listo.`
      : 'Tu espacio está listo. Revisá tu email para verificar la cuenta.');
    void loadPrivateData('cookie-session').catch((error) => setNotice(errorMessage(error)));
  }

  async function logout() {
    await api<void>('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    setToken(null);
    setUser(null);
    setMonitors([]);
    setAlerts([]);
    setSaved([]);
    setOperatorProfile(null);
    setManagedPublications([]);
    setInquiries([]);
    setNotificationPreference(null);
    setActiveTab('discover');
  }

  async function resendVerification() {
    if (!user) return;
    try {
      await api('/v1/auth/verification/request', {
        method: 'POST', body: JSON.stringify({ email: user.email })
      });
      setNotice('Si la cuenta requiere verificación, enviamos un nuevo enlace.');
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  async function updateNotificationPreference(update: Partial<NotificationPreference>) {
    if (!token) return;
    try {
      const preference = await api<NotificationPreference>('/v1/notification-preferences', {
        method: 'PATCH', body: JSON.stringify(update)
      }, token);
      setNotificationPreference(preference);
      setNotice('Preferencias de avisos actualizadas.');
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  return (
    <div className="appFrame">
      <a className="skipLink" href="#main-content">Saltar al contenido principal</a>
      <aside className="sideRail" aria-label="Navegación principal" aria-hidden={modalOpen} inert={modalOpen}>
        <Brand />
        <NavItems active={activeTab} unread={unreadAlerts} onSelect={selectTab} />
        <button className="accountSummary" onClick={() => token ? setActiveTab('profile') : setAuthOpen(true)}>
          <span className="accountAvatar">{user?.displayName?.[0] ?? user?.email[0]?.toUpperCase() ?? '?'}</span>
          <span><strong>{user?.displayName ?? 'Tu espacio'}</strong><small>{user ? user.email : 'Ingresar o crear cuenta'}</small></span>
          <ChevronRight size={17} />
        </button>
      </aside>

      <main className="mainContent" id="main-content" tabIndex={-1} aria-hidden={modalOpen} inert={modalOpen}>
        <header className="mobileHeader">
          <Brand />
          <button className="iconButton" aria-label={mobileMenu ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={mobileMenu} aria-controls="mobile-menu" onClick={() => setMobileMenu(!mobileMenu)}><Menu /></button>
        </header>
        {mobileMenu && <div className="mobileMenu" id="mobile-menu"><NavItems active={activeTab} unread={unreadAlerts} onSelect={selectTab} /></div>}

        {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Cerrar mensaje" onClick={() => setNotice(null)}><X size={17} /></button></div>}

        {activeTab === 'discover' && <Discover
          intent={intent}
          setIntent={(value) => { setIntent(value); setCriteriaConfirmed(false); }}
          criteria={criteria}
          setCriteria={(value) => { setCriteria(value); setCriteriaConfirmed(false); }}
          interpretation={interpretation}
          interpreting={interpreting}
          criteriaConfirmed={criteriaConfirmed}
          criteriaOpen={criteriaOpen}
          setCriteriaOpen={setCriteriaOpen}
          opportunities={opportunities}
          loading={loading}
          savedIds={savedIds}
          onInterpret={interpretIntent}
          onApply={applyCriteria}
          onCreateMonitor={createMonitor}
          onOpen={openDetail}
          onSave={toggleSaved}
          onDismiss={dismiss}
          comparisonIds={new Set(comparisonIds)}
          onCompare={toggleComparison}
        />}
        {activeTab === 'monitors' && <Monitors monitors={monitors} alerts={alerts} authenticated={Boolean(token)} onToggle={toggleMonitor} onRead={markRead} onDiscover={() => setActiveTab('discover')} />}
        {activeTab === 'publish' && <Publish token={token} onNeedAuth={() => setAuthOpen(true)} onNotice={setNotice} />}
        {activeTab === 'saved' && <Saved items={saved} authenticated={Boolean(token)} comparisonIds={new Set(comparisonIds)} onOpen={openDetail} onRemove={toggleSaved} onCompare={toggleComparison} onDiscover={() => setActiveTab('discover')} />}
        {activeTab === 'profile' && <Profile user={user} notificationPreference={notificationPreference} operatorProfile={operatorProfile} publications={managedPublications} inquiries={inquiries} onLogin={() => setAuthOpen(true)} onLogout={logout} onResendVerification={resendVerification} onUpdateNotificationPreference={updateNotificationPreference} onCreateOperator={createOperatorProfile} onUpdatePublication={updateManagedPublication} />}
      </main>

      <nav className="bottomNav" aria-label="Navegación principal" aria-hidden={modalOpen} inert={modalOpen}>
        <NavButton tab="discover" label="Descubrir" icon={<Compass />} active={activeTab} onSelect={selectTab} />
        <NavButton tab="monitors" label="Monitores" icon={<Bell />} badge={unreadAlerts} active={activeTab} onSelect={selectTab} />
        <NavButton tab="publish" label="Publicar" icon={<FilePlus2 />} active={activeTab} onSelect={selectTab} featured />
        <NavButton tab="saved" label="Guardados" icon={<Bookmark />} active={activeTab} onSelect={selectTab} />
        <NavButton tab="profile" label="Vos" icon={<CircleUserRound />} active={activeTab} onSelect={selectTab} />
      </nav>

      {comparisonIds.length > 0 && <div className="comparisonTray" role="status" aria-hidden={modalOpen} inert={modalOpen}><span><Scale size={17} /> {comparisonIds.length} de 3 para comparar</span><div><button className="quietButton" onClick={() => setComparisonIds([])}>Limpiar</button><button className="primaryButton" disabled={comparisonItems.length < 2} onClick={() => setComparisonOpen(true)}>Comparar</button></div></div>}

      {detail && <DetailPanel detail={detail} isSaved={savedIds.has(detail.opportunity.id)} operatorProfile={operatorProfile} authenticated={Boolean(token)} onClose={() => setDetail(null)} onSave={() => toggleSaved(detail.opportunity)} onInquiry={sendInquiry} onClaim={claimPublication} onNeedAuth={() => { setDetail(null); setAuthOpen(true); }} />}
      {comparisonOpen && <ComparisonPanel items={comparisonItems} criteria={criteria} onClose={() => setComparisonOpen(false)} onRemove={(id) => setComparisonIds((current) => current.filter((item) => item !== id))} />}
      {authOpen && <AuthPanel mode={authMode} resetToken={resetToken} setMode={setAuthMode} onClose={() => setAuthOpen(false)} onAuthenticated={onAuthenticated} onNotice={setNotice} />}
    </div>
  );
}

function Brand() {
  return <div className="brand" aria-label="Umbral, inicio"><span className="brandMark"><House size={18} /></span><span>Umbral</span></div>;
}

function NavItems({ active, unread, onSelect }: { active: Tab; unread: number; onSelect: (tab: Tab) => void }) {
  const items: Array<{ tab: Tab; label: string; icon: React.ReactNode; badge?: number }> = [
    { tab: 'discover', label: 'Descubrir', icon: <Compass /> },
    { tab: 'monitors', label: 'Monitores', icon: <Bell />, badge: unread },
    { tab: 'saved', label: 'Guardados', icon: <Bookmark /> },
    { tab: 'publish', label: 'Publicar', icon: <FilePlus2 /> }
  ];
  return <div className="navItems">{items.map((item) => <button key={item.tab} className={active === item.tab ? 'active' : ''} aria-current={active === item.tab ? 'page' : undefined} onClick={() => onSelect(item.tab)}>{item.icon}<span>{item.label}</span>{Boolean(item.badge) && <b>{item.badge}</b>}</button>)}</div>;
}

function NavButton({ tab, label, icon, badge, active, onSelect, featured = false }: { tab: Tab; label: string; icon: React.ReactNode; badge?: number; active: Tab; onSelect: (tab: Tab) => void; featured?: boolean }) {
  return <button className={`${active === tab ? 'active' : ''} ${featured ? 'featured' : ''}`} onClick={() => onSelect(tab)} aria-current={active === tab ? 'page' : undefined}><span className="navIcon">{icon}{Boolean(badge) && <b>{badge}</b>}</span><small>{label}</small></button>;
}

type DiscoverProps = {
  intent: string;
  setIntent: (value: string) => void;
  criteria: SearchCriteria;
  setCriteria: (value: SearchCriteria) => void;
  interpretation: IntentInterpretation | null;
  interpreting: boolean;
  criteriaConfirmed: boolean;
  criteriaOpen: boolean;
  setCriteriaOpen: (value: boolean) => void;
  opportunities: Opportunity[];
  loading: boolean;
  savedIds: Set<string>;
  comparisonIds: Set<string>;
  onInterpret: (event: FormEvent) => void | Promise<void>;
  onApply: () => void;
  onCreateMonitor: () => void;
  onOpen: (id: string) => void;
  onSave: (item: Opportunity) => void;
  onDismiss: (item: Opportunity) => void;
  onCompare: (item: Opportunity) => void;
};

function Discover(props: DiscoverProps) {
  return <>
    <section className="hero">
      <div className="heroIntro">
        <span className="sectionKicker"><Sparkles size={15} /> Tu búsqueda, mejor curada</span>
        <h1>Encontrá un lugar<br />que realmente encaje.</h1>
        <p>Describí cómo querés vivir. Umbral reúne avisos repetidos, verifica cambios y prioriza las propiedades que merecen una visita.</p>
        <div className="heroProof" aria-label="Cobertura y confianza">
          <span><ShieldCheck size={16} /> Fuentes visibles</span>
          <span><Clock3 size={16} /> Cambios monitoreados</span>
        </div>
      </div>
      <div className="heroVisual">
        <Image src="/properties/mendoza-patio.jpg" alt="Casa contemporánea abierta a un patio en Mendoza, imagen editorial de referencia" width={1280} height={853} priority sizes="(max-width: 800px) 100vw, 44vw" />
        <span className="referenceBadge"><Images size={14} /> Imagen de referencia</span>
        <div className="heroLocation"><MapPin size={16} /><span><strong>Chacras de Coria</strong><small>Mendoza</small></span></div>
      </div>
    </section>

    <form className="intentComposer" onSubmit={props.onInterpret}>
      <label htmlFor="intent"><Search size={16} /> Contanos qué estás buscando</label>
      <textarea id="intent" value={props.intent} onChange={(event) => props.setIntent(event.target.value)} rows={3} minLength={5} required />
      <div className="composerFooter">
        <span><ShieldCheck size={16} /> Nada se activa sin tu confirmación</span>
        <button className="primaryButton" type="submit" disabled={props.interpreting}>
          {props.interpreting ? <><LoaderCircle className="spin" size={17} /> Interpretando…</> : <><Sparkles size={17} /> Interpretar búsqueda</>}
        </button>
      </div>
    </form>

    <section className={`criteriaPanel ${props.criteriaOpen ? 'open' : ''}`} aria-label="Criterios interpretados">
      <button className="criteriaHeader" onClick={() => props.setCriteriaOpen(!props.criteriaOpen)} aria-expanded={props.criteriaOpen}>
        <span><Check size={17} /> Borrador editable</span><span><ListFilter size={16} /> {props.criteriaOpen ? 'Ocultar' : 'Revisar criterios'}</span>
      </button>
      {props.criteriaOpen && <div className="criteriaBody">
        <div className="interpretationMeta" role="status">
          <span className={`confidence confidence-${props.interpretation?.confidence ?? 'pending'}`}>
            {props.criteriaConfirmed ? 'Criterios confirmados' : props.interpretation ? `Confianza ${confidenceLabel(props.interpretation.confidence)}` : 'Pendiente de confirmación'}
          </span>
          <p>{interpretationMessage(props.interpretation)}</p>
          {props.interpretation?.assumptions.length ? <ul>{props.interpretation.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul> : null}
        </div>
        <Field label="Operación"><select value={props.criteria.operation ?? ''} onChange={(event) => props.setCriteria({ ...props.criteria, operation: event.target.value ? event.target.value as Operation : undefined })}><option value="">Sin definir</option><option value="sale">Comprar</option><option value="rent">Alquilar</option></select></Field>
        <Field label="Zonas"><input value={props.criteria.locations?.join(', ') ?? ''} list="launch-markets" placeholder="Palermo, Colegiales" onChange={(event) => props.setCriteria({ ...props.criteria, locations: event.target.value.trim() ? event.target.value.split(',').map((location) => location.trim()).filter(Boolean).slice(0, 5) : undefined })} /><datalist id="launch-markets">{cities.map((city) => <option key={city} value={city} />)}</datalist></Field>
        <Field label="Moneda"><select value={props.criteria.currency ?? ''} onChange={(event) => props.setCriteria({ ...props.criteria, currency: event.target.value ? event.target.value as Currency : undefined })}><option value="">Sin definir</option><option>USD</option><option>ARS</option></select></Field>
        <Field label="Desde"><input type="number" min="0" value={props.criteria.minPrice ?? ''} placeholder="Sin mínimo" onChange={(event) => props.setCriteria({ ...props.criteria, minPrice: event.target.value ? Number(event.target.value) : undefined })} /></Field>
        <Field label="Hasta"><input type="number" min="0" value={props.criteria.maxPrice ?? ''} placeholder="Sin máximo" onChange={(event) => props.setCriteria({ ...props.criteria, maxPrice: event.target.value ? Number(event.target.value) : undefined })} /></Field>
        <Field label="Ambientes"><input type="number" min="0" value={props.criteria.rooms ?? ''} placeholder="Cualquiera" onChange={(event) => props.setCriteria({ ...props.criteria, rooms: event.target.value ? Number(event.target.value) : undefined })} /></Field>
        <Field label="Dormitorios"><input type="number" min="0" value={props.criteria.bedrooms ?? ''} placeholder="Cualquiera" onChange={(event) => props.setCriteria({ ...props.criteria, bedrooms: event.target.value ? Number(event.target.value) : undefined })} /></Field>
        <Field label="Superficie desde"><input type="number" min="0" value={props.criteria.minAreaM2 ?? ''} placeholder="Sin mínimo" onChange={(event) => props.setCriteria({ ...props.criteria, minAreaM2: event.target.value ? Number(event.target.value) : undefined })} /></Field>
        <Field label="Excluir pisos"><input value={props.criteria.excludedFloors?.join(', ') ?? ''} placeholder="Ej. Planta baja" onChange={(event) => props.setCriteria({ ...props.criteria, excludedFloors: event.target.value.trim() ? event.target.value.split(',').map((value) => value.trim()).filter(Boolean) : undefined })} /></Field>
        <Field label="Preferencias"><input value={props.criteria.preferences?.join(', ') ?? ''} placeholder="Balcón, luminoso" onChange={(event) => props.setCriteria({ ...props.criteria, preferences: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></Field>
        <div className="criteriaActions"><button className="secondaryButton" type="button" onClick={props.onApply}><Search size={17} /> Ver oportunidades</button><button className="quietButton" type="button" onClick={props.onCreateMonitor}><Bell size={17} /> Activar monitor diario</button></div>
      </div>}
    </section>

    <section className="resultsSection">
      <div className="sectionHeading"><div><span className="sectionKicker">Selección para vos</span><h2>Propiedades que vale la pena mirar</h2><p>Una ficha por propiedad, aunque aparezca publicada en más de un lugar.</p></div><span className="resultCount" role="status" aria-live="polite">{props.loading ? 'Buscando…' : `${props.opportunities.length} encontradas`}</span></div>
      {props.loading ? <LoadingState /> : props.opportunities.length ? <div className="opportunityGrid">{props.opportunities.map((item, index) => <OpportunityCard key={item.id} item={item} index={index} saved={props.savedIds.has(item.id)} compared={props.comparisonIds.has(item.id)} onOpen={props.onOpen} onSave={props.onSave} onDismiss={props.onDismiss} onCompare={props.onCompare} />)}</div> : <EmptyState icon={<Search />} title="Todavía no encontramos coincidencias" body="Probá ampliando la zona o el presupuesto. Si activás un monitor, seguimos buscando por vos." action="Revisar criterios" onAction={() => props.setCriteriaOpen(true)} />}
    </section>
  </>;
}

function confidenceLabel(confidence: IntentInterpretation['confidence']): string {
  if (confidence === 'high') return 'alta';
  if (confidence === 'medium') return 'media';
  return 'baja';
}

function interpretationMessage(interpretation: IntentInterpretation | null): string {
  if (!interpretation) return 'Este borrador inicial es editable. Confirmalo antes de delegar el seguimiento.';
  if (interpretation.fallbackReason) return 'El asistente no respondió a tiempo; usamos una interpretación local y segura. Revisala antes de continuar.';
  return interpretation.provider === 'openai'
    ? 'El asistente propuso estos criterios. Vos decidís qué conservar antes de buscar.'
    : 'Interpretamos el texto con reglas locales. Revisá cada criterio antes de buscar.';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function OpportunityCard({ item, index, saved, compared, onOpen, onSave, onDismiss, onCompare }: { item: Opportunity; index: number; saved: boolean; compared: boolean; onOpen: (id: string) => void; onSave: (item: Opportunity) => void; onDismiss: (item: Opportunity) => void; onCompare: (item: Opportunity) => void }) {
  const visual = propertyVisual(item, index);
  return <article className="opportunityCard">
    <button className="propertyMedia" onClick={() => onOpen(item.id)} aria-label={`Ver ${item.title}`}>
      <Image src={visual.src} alt={visual.alt} width={1280} height={853} loading={index === 0 ? 'eager' : 'lazy'} sizes="(max-width: 560px) 100vw, (max-width: 1100px) 42vw, 32vw" />
      <span className="referenceBadge"><Images size={14} /> Imagen de referencia</span>
      <span className="photoCount"><Images size={14} /> {visual.count}</span>
      <span className="matchBadge">{index === 0 ? '93%' : '88%'} afinidad</span>
    </button>
    <div className="opportunityBody">
      <div className="cardTopline"><span className="freshness"><span className="statusDot active" />{freshnessLabel(item.freshness)}</span><button className={`saveButton ${saved ? 'saved' : ''}`} onClick={() => onSave(item)} aria-label={saved ? 'Quitar de guardados' : 'Guardar oportunidad'}><Heart fill={saved ? 'currentColor' : 'none'} /></button></div>
      <button className="cardTitle" onClick={() => onOpen(item.id)}><strong>{formatMoney(item.price, item.currency)}</strong><span><MapPin size={14} />{item.address ?? item.title}</span></button>
      <div className="facts"><span>{item.rooms === null ? 'Amb. sin dato' : `${item.rooms} amb.`}</span><span>{item.areaTotalM2 === null ? 'Sup. sin dato' : `${item.areaTotalM2} m²`}</span><span>{item.publicationCount} {item.publicationCount === 1 ? 'publicación' : 'publicaciones'}</span></div>
      <div className="signalLine"><ArrowDownRight size={17} /><span>{item.publicationCount > 1 ? 'Consolidamos las fuentes y priorizamos la mejor evidencia.' : 'Una fuente activa con trazabilidad visible.'}</span></div>
      <div className="cardActions"><button onClick={() => onOpen(item.id)}>Ver propiedad <ChevronRight size={16} /></button><button onClick={() => onCompare(item)} aria-pressed={compared}><Scale size={16} /> {compared ? 'Comparando' : 'Comparar'}</button><button onClick={() => onDismiss(item)}><EyeOff size={16} /> Descartar</button></div>
    </div>
  </article>;
}

function Monitors({ monitors, alerts, authenticated, onToggle, onRead, onDiscover }: { monitors: Monitor[]; alerts: Alert[]; authenticated: boolean; onToggle: (monitor: Monitor) => void; onRead: (alert: Alert) => void; onDiscover: () => void }) {
  if (!authenticated) return <EmptyState icon={<LogIn />} title="Tus monitores viven en tu cuenta" body="Ingresá para delegar búsquedas y recibir sólo cambios relevantes." />;
  return <section className="pageSection">
    <PageHeading kicker="Seguimiento continuo" title="Monitores" body="Cada búsqueda vuelve a ejecutarse sola. Los cambios sin impacto se silencian." action={<button className="primaryButton" onClick={onDiscover}><Search size={17} /> Nueva búsqueda</button>} />
    <div className="twoColumn">
      <div><h2 className="subheading">Búsquedas activas</h2>{monitors.length ? <div className="stack">{monitors.map((monitor) => <article className="monitorCard" key={monitor.id}><div className="monitorStatus"><span className={monitor.enabled ? 'statusDot active' : 'statusDot'} /><span>{monitor.enabled ? 'Activo' : 'En pausa'}</span></div><h3>{monitor.name}</h3><p>{monitor.intentText}</p><div className="monitorMeta"><span><Clock3 size={15} /> Próxima: {formatDate(monitor.nextRunAt)}</span><span>{monitor.cadence === 'daily' ? 'Diario' : monitor.cadence === 'hourly' ? 'Cada hora' : 'Semanal'}</span></div><button className="secondaryButton" onClick={() => onToggle(monitor)}>{monitor.enabled ? <><Pause size={16} /> Pausar</> : <><Play size={16} /> Reanudar</>}</button></article>)}</div> : <EmptyState icon={<Bell />} title="Todavía no hay monitores" body="Empezá con una búsqueda y activala cuando los criterios estén bien." action="Crear una búsqueda" onAction={onDiscover} />}</div>
      <div><h2 className="subheading">Cambios relevantes</h2>{alerts.length ? <div className="stack">{alerts.map((alert) => <button key={alert.id} className={`alertCard ${alert.readAt ? '' : 'unread'}`} onClick={() => onRead(alert)}><span className="alertIcon"><Bell size={18} /></span><span><strong>{alert.title}</strong><small>{alert.body}</small><time>{formatDate(alert.createdAt)}</time></span>{!alert.readAt && <i>Nueva</i>}</button>)}</div> : <EmptyState icon={<ShieldCheck />} title="Todo tranquilo" body="Acá aparecerán nuevas coincidencias, bajas de precio y cambios de disponibilidad." />}</div>
    </div>
  </section>;
}

function Saved({ items, authenticated, comparisonIds, onOpen, onRemove, onCompare, onDiscover }: { items: Opportunity[]; authenticated: boolean; comparisonIds: Set<string>; onOpen: (id: string) => void; onRemove: (item: Opportunity) => void; onCompare: (item: Opportunity) => void; onDiscover: () => void }) {
  if (!authenticated) return <EmptyState icon={<LogIn />} title="Guardá una selección propia" body="Ingresá para comparar oportunidades sin volver a buscarlas." />;
  return <section className="pageSection"><PageHeading kicker="Tu preselección" title="Guardados" body="Un espacio corto para decidir mejor, no otra lista interminable." />{items.length ? <div className="savedList">{items.map((item, index) => <OpportunityCard key={item.id} item={item} index={index} saved compared={comparisonIds.has(item.id)} onOpen={onOpen} onSave={onRemove} onDismiss={() => undefined} onCompare={onCompare} />)}</div> : <EmptyState icon={<Bookmark />} title="Tu selección está vacía" body="Guardá las propiedades que quieras revisar con más calma." action="Ir a descubrir" onAction={onDiscover} />}</section>;
}

function Publish({ token, onNeedAuth, onNotice }: { token: string | null; onNeedAuth: () => void; onNotice: (message: string) => void }) {
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return onNeedAuth();
    const form = event.currentTarget;
    setSubmitting(true);
    const data = new FormData(form);
    try {
      const result = await api<{ propertyId: string; potentialDuplicateCount: number }>('/v1/publications', {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          address: data.get('address'), operation: data.get('operation'),
          currency: data.get('currency'), price: Number(data.get('price')),
          propertyType: data.get('propertyType'), rooms: data.get('rooms') ? Number(data.get('rooms')) : undefined,
          areaTotalM2: data.get('area') ? Number(data.get('area')) : undefined,
          description: data.get('description') || undefined
        })
      }, token);
      form.reset();
      onNotice(result.potentialDuplicateCount ? 'Publicación creada. Hay una posible coincidencia para revisión.' : 'Publicación creada y vinculada a su oportunidad canónica.');
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }
  return <section className="pageSection publishPage"><PageHeading kicker="Publicación directa" title="Publicá lo esencial" body="Empezá con los datos que definen la oportunidad. La trazabilidad queda visible y cualquier posible duplicado pasa a revisión." /><form className="publishForm" onSubmit={submit}><Field label="Dirección completa"><input name="address" required minLength={4} placeholder="Ej. Aráoz 1840, 4° B, Palermo" /></Field><div className="formRow"><Field label="Operación"><select name="operation"><option value="sale">Venta</option><option value="rent">Alquiler</option></select></Field><Field label="Tipo"><select name="propertyType"><option>Departamento</option><option>Casa</option><option>PH</option><option>Terreno</option></select></Field></div><div className="formRow"><Field label="Moneda"><select name="currency"><option>USD</option><option>ARS</option></select></Field><Field label="Precio"><input name="price" type="number" min="1" required placeholder="180000" /></Field></div><div className="formRow"><Field label="Ambientes"><input name="rooms" type="number" min="1" placeholder="3" /></Field><Field label="Superficie total"><input name="area" type="number" min="1" step="0.1" placeholder="72" /></Field></div><Field label="Descripción opcional"><textarea name="description" rows={4} maxLength={10000} placeholder="Estado, orientación, expensas y aquello que una visita debería saber." /></Field><div className="publishAssurance"><ShieldCheck /><span><strong>Control antes que velocidad.</strong> No fusionamos propiedades dudosas automáticamente.</span></div><button className="primaryButton submitButton" disabled={submitting}>{submitting ? <><LoaderCircle className="spin" /> Publicando…</> : <><FilePlus2 /> Publicar oportunidad</>}</button></form></section>;
}

type ProfileProps = {
  user: User | null;
  notificationPreference: NotificationPreference | null;
  operatorProfile: OperatorProfile | null;
  publications: ManagedPublication[];
  inquiries: Inquiry[];
  onLogin: () => void;
  onLogout: () => void;
  onResendVerification: () => void;
  onUpdateNotificationPreference: (update: Partial<NotificationPreference>) => void;
  onCreateOperator: (input: { displayName: string; licenseNumber?: string; websiteUrl?: string }) => void;
  onUpdatePublication: (publication: ManagedPublication, update: { status?: 'active' | 'paused' | 'removed'; declaredAvailability?: ManagedPublication['declaredAvailability'] }) => void;
};

function Profile(props: ProfileProps) {
  function submitOperator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    props.onCreateOperator({
      displayName: String(data.get('displayName') ?? ''),
      licenseNumber: String(data.get('licenseNumber') ?? '') || undefined,
      websiteUrl: String(data.get('websiteUrl') ?? '') || undefined
    });
  }
  return <section className="pageSection">
    <PageHeading kicker="Cuenta y confianza" title={props.user?.displayName ?? 'Tu espacio'} body={props.user ? props.user.email : 'Creá una cuenta para conservar búsquedas, guardados y alertas.'} />
    <div className="profileCard"><span className="largeAvatar">{props.user?.displayName?.[0] ?? props.user?.email[0]?.toUpperCase() ?? '?'}</span><div><h2>{props.user ? 'Sesión activa' : 'Todavía no ingresaste'}</h2><p>{props.user ? props.user.emailVerified ? 'Email verificado y sesión protegida.' : 'Tu email todavía necesita verificación.' : 'Sólo pedimos lo necesario para guardar tu actividad.'}</p></div><div className="accountActions">{props.user && !props.user.emailVerified && <button className="quietButton" onClick={props.onResendVerification}>Reenviar verificación</button>}<button className={props.user ? 'secondaryButton' : 'primaryButton'} onClick={props.user ? props.onLogout : props.onLogin}>{props.user ? 'Cerrar sesión' : 'Ingresar'}</button></div></div>
    {props.user && props.notificationPreference && <section className="notificationPreferences"><div><span className="sectionKicker"><Bell size={15} /> Avisos</span><h2>Elegí cómo enterarte</h2><p>Los emails sólo salen después de verificar la cuenta. Podés pausar todos los resúmenes sin perder tus monitores.</p></div><div><label><input type="checkbox" checked={props.notificationPreference.inAppEnabled} onChange={(event) => props.onUpdateNotificationPreference({ inAppEnabled: event.target.checked })} /> Avisos dentro de Umbral</label><label><input type="checkbox" checked={props.notificationPreference.emailEnabled} onChange={(event) => props.onUpdateNotificationPreference({ emailEnabled: event.target.checked })} /> Resúmenes por email</label><label><input type="checkbox" checked={props.notificationPreference.digestEnabled} onChange={(event) => props.onUpdateNotificationPreference({ digestEnabled: event.target.checked })} /> Recibir resúmenes de cambios</label></div></section>}
    {props.user && !props.operatorProfile && <section className="professionalCard"><div><span className="sectionKicker"><BadgeCheck size={15} /> Espacio profesional</span><h2>¿Trabajás con propiedades?</h2><p>Creá un perfil para gestionar inventario, solicitar la representación de publicaciones agregadas y recibir consultas sin desviar contactos a terceros.</p></div><form onSubmit={submitOperator}><Field label="Nombre comercial"><input name="displayName" required minLength={2} defaultValue={props.user.displayName ?? ''} /></Field><Field label="Matrícula"><input name="licenseNumber" placeholder="Ej. CPI 1234" /></Field><Field label="Sitio web"><input name="websiteUrl" type="url" placeholder="https://" /></Field><button className="primaryButton">Crear perfil profesional</button></form></section>}
    {props.operatorProfile && <section className="professionalWorkspace"><div className="workspaceHeading"><div><span className="sectionKicker"><BadgeCheck size={15} /> Operador</span><h2>{props.operatorProfile.displayName}</h2><p>{props.operatorProfile.licenseNumber ?? 'Matrícula no informada'}</p></div><span className={`verificationBadge ${props.operatorProfile.verificationStatus}`}>{verificationLabel(props.operatorProfile.verificationStatus)}</span></div><div className="operatorMetrics"><span><strong>{props.publications.length}</strong> publicaciones</span><span><strong>{props.publications.filter((item) => item.status === 'active').length}</strong> activas</span><span><strong>{props.inquiries.filter((item) => item.status === 'new').length}</strong> consultas nuevas</span></div><div className="twoColumn operatorColumns"><div><h3 className="subheading">Mis publicaciones</h3>{props.publications.length ? <div className="stack">{props.publications.map((publication) => <article className="managedCard" key={publication.id}><span className="monitorStatus"><span className={publication.status === 'active' ? 'statusDot active' : 'statusDot'} />{publication.status === 'active' ? 'Activa' : publication.status === 'paused' ? 'En pausa' : 'Retirada'}</span><h4>{publication.address ?? publication.title}</h4><p>{formatMoney(publication.price, publication.currency)} · versión {publication.version}</p><div className="managedActions"><button className="secondaryButton" onClick={() => props.onUpdatePublication(publication, { status: publication.status === 'active' ? 'paused' : 'active', declaredAvailability: publication.status === 'active' ? 'unavailable' : 'available' })}>{publication.status === 'active' ? 'Pausar' : 'Reactivar'}</button><button className="quietButton" onClick={() => props.onUpdatePublication(publication, { status: 'removed', declaredAvailability: publication.propertyStatus === 'rented' ? 'rented' : 'sold' })}>Marcar cerrada</button></div></article>)}</div> : <p className="mutedCopy">Tus publicaciones directas y las representaciones aprobadas aparecerán acá.</p>}</div><div><h3 className="subheading"><Inbox size={18} /> Consultas recibidas</h3>{props.inquiries.length ? <div className="stack">{props.inquiries.map((inquiry) => <article className="inquiryCard" key={inquiry.id}><span>{inquiry.status === 'new' ? 'Nueva' : 'En seguimiento'}</span><p>{inquiry.message}</p><time>{formatDate(inquiry.createdAt)}</time></article>)}</div> : <p className="mutedCopy">Todavía no recibiste consultas.</p>}</div></div></section>}
    <div className="trustGrid"><article><ShieldCheck /><h3>Decisiones explicables</h3><p>La fuente, frescura y confianza quedan visibles.</p></article><article><Eye /><h3>Tu señal, sin ruido</h3><p>Los monitores suprimen cambios que no importan.</p></article><article><MessageCircle /><h3>IA bajo tu control</h3><p>Los criterios inferidos siempre se pueden editar.</p></article></div>
  </section>;
}

function verificationLabel(status: OperatorProfile['verificationStatus']): string {
  if (status === 'verified') return 'Verificado';
  if (status === 'pending') return 'Verificación pendiente';
  if (status === 'suspended') return 'Suspendido';
  return 'No verificado';
}

type DetailPanelProps = {
  detail: OpportunityDetail;
  isSaved: boolean;
  operatorProfile: OperatorProfile | null;
  authenticated: boolean;
  onClose: () => void;
  onSave: () => void;
  onInquiry: (publicationId: string, message: string) => void;
  onClaim: (publicationId: string) => void;
  onNeedAuth: () => void;
};

function DetailPanel({ detail, isSaved, operatorProfile, authenticated, onClose, onSave, onInquiry, onClaim, onNeedAuth }: DetailPanelProps) {
  const dialogRef = useDialogFocus<HTMLElement>();
  const [inquiryFor, setInquiryFor] = useState<string | null>(null);
  const [answer, setAnswer] = useState<PropertyAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const item = detail.opportunity;
  const visual = propertyVisual(item);
  async function askProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setAsking(true);
    try {
      setAnswer(await api<PropertyAnswer>(`/v1/opportunities/${item.id}/questions`, {
        method: 'POST', body: JSON.stringify({ question: data.get('question') })
      }));
    } catch (error) {
      setAnswer({
        answer: errorMessage(error), evidence: [], caveats: [], provider: 'deterministic', promptVersion: 'error'
      });
    } finally {
      setAsking(false);
    }
  }
  function startInquiry(publicationId: string) {
    if (!authenticated) return onNeedAuth();
    setInquiryFor(publicationId);
  }
  function submitInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inquiryFor) return;
    const data = new FormData(event.currentTarget);
    onInquiry(inquiryFor, String(data.get('message') ?? ''));
    setInquiryFor(null);
  }
  return <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section ref={dialogRef} className="detailPanel" role="dialog" aria-modal="true" aria-labelledby="detail-title"><div className="panelHeader"><span>Oportunidad verificada</span><button className="iconButton" onClick={onClose} aria-label="Cerrar detalle" autoFocus><X /></button></div><figure className="detailMedia"><Image src={visual.src} alt={visual.alt} width={1280} height={853} priority sizes="(max-width: 620px) 100vw, 620px" /><figcaption className="referenceBadge"><Images size={14} /> Imagen editorial de referencia</figcaption><span className="photoCount"><Images size={14} /> {visual.count} fotos</span></figure><div className="detailContent"><div className="detailLead"><div><span className="freshness"><span className="statusDot active" />{freshnessLabel(item.freshness)}</span><h2 id="detail-title">{formatMoney(item.price, item.currency)}</h2><p><MapPin size={15} />{item.address}</p></div><button className={`saveButton ${isSaved ? 'saved' : ''}`} onClick={onSave} aria-label={isSaved ? 'Quitar de guardados' : 'Guardar oportunidad'}><Heart fill={isSaved ? 'currentColor' : 'none'} /><span>{isSaved ? 'Guardada' : 'Guardar'}</span></button></div><div className="detailFacts"><span><strong>{item.rooms ?? '—'}</strong> ambientes</span><span><strong>{item.areaTotalM2 ?? '—'}</strong> m² totales</span><span><strong>{item.publicationCount}</strong> fuentes</span></div><section className="evidenceBlock"><span className="sectionKicker">Por qué verla</span><h3>Una sola propiedad, toda la evidencia</h3><p>Consolidamos las publicaciones vinculadas sin ocultar quién publicó, cuándo se verificó ni qué precio informa cada fuente.</p></section><section className="assistantBlock"><span className="sectionKicker"><Sparkles size={15} /> Preguntale a la ficha</span><h3>Una respuesta con evidencia</h3><form onSubmit={askProperty}><input name="question" aria-label="Pregunta sobre la propiedad" required minLength={3} maxLength={1000} placeholder="Ej. ¿Cuál es el precio por m²?" /><button className="primaryButton" disabled={asking}>{asking ? <LoaderCircle className="spin" /> : <MessageCircle />}{asking ? 'Revisando…' : 'Preguntar'}</button></form>{answer && <div className="assistantAnswer" role="status"><p>{answer.answer}</p>{answer.evidence.length > 0 && <dl>{answer.evidence.map((fact) => <div key={`${fact.label}-${fact.value}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}{answer.caveats.map((caveat) => <small key={caveat}>{caveat}</small>)}</div>}</section><section><div className="sectionHeading compact"><div><span className="sectionKicker">Proveniencia</span><h3>Publicaciones de origen</h3></div></div><div className="sourceList">{detail.publications.map((publication) => <article className="sourceCard" key={publication.id}><a href={publication.sourceUrl} target="_blank" rel="noreferrer"><span className="sourceIcon"><Building2 size={18} /></span><span><strong>{publication.sourceName}</strong><small>{publication.publisherName ?? (publication.publisherType === 'owner' ? 'Dueño directo' : 'Publicación agregada')} · {formatMoney(publication.price, publication.currency)}</small></span><span className={`sourceStatus ${publication.status}`}>{publication.status === 'active' ? 'Activa' : 'Revisar'}</span><ChevronRight size={17} /></a>{publication.status === 'active' && publication.publisherType !== 'aggregated' && <button className="sourceAction" onClick={() => startInquiry(publication.id)}><MessageCircle size={16} /> Consultar a esta fuente</button>}{publication.publisherType === 'aggregated' && operatorProfile?.verificationStatus === 'verified' && <button className="sourceAction" onClick={() => onClaim(publication.id)}><BadgeCheck size={16} /> Solicitar representación</button>}</article>)}</div>{inquiryFor && <form className="inquiryComposer" onSubmit={submitInquiry}><Field label="Tu consulta"><textarea name="message" required minLength={10} maxLength={4000} rows={3} autoFocus placeholder="Quisiera conocer disponibilidad y coordinar una visita." /></Field><div><button type="button" className="quietButton" onClick={() => setInquiryFor(null)}>Cancelar</button><button className="primaryButton">Enviar consulta</button></div></form>}</section></div></section></div>;
}

function ComparisonPanel({ items, criteria, onClose, onRemove }: { items: Opportunity[]; criteria: SearchCriteria; onClose: () => void; onRemove: (id: string) => void }) {
  const dialogRef = useDialogFocus<HTMLElement>();
  return <div className="overlay comparisonOverlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section ref={dialogRef} className="comparisonPanel" role="dialog" aria-modal="true" aria-labelledby="comparison-title"><div className="panelHeader"><span>Comparación objetiva</span><button className="iconButton" onClick={onClose} aria-label="Cerrar comparación" autoFocus><X /></button></div><div className="comparisonContent"><span className="sectionKicker"><Scale size={15} /> Decidir con contexto</span><h2 id="comparison-title">Tus oportunidades, lado a lado</h2><p>Comparamos la ficha canónica. Lo que no está respaldado por una fuente queda sin afirmar.</p><div className="comparisonGrid">{items.map((item, index) => { const visual = propertyVisual(item, index); return <article key={item.id}><div className="comparisonImage"><Image src={visual.src} alt={visual.alt} width={1280} height={853} sizes="(max-width: 560px) 100vw, 30vw" /></div><button className="removeComparison" aria-label={`Quitar ${item.title} de la comparación`} onClick={() => onRemove(item.id)}><X size={16} /></button><h3>{formatMoney(item.price, item.currency)}</h3><p>{item.address ?? item.title}</p><dl><ComparisonFact label="Ambientes" value={item.rooms === null ? 'Sin dato' : String(item.rooms)} /><ComparisonFact label="Superficie" value={item.areaTotalM2 === null ? 'Sin dato' : `${item.areaTotalM2} m²`} /><ComparisonFact label="Precio por m²" value={item.price !== null && item.areaTotalM2 ? formatMoney(Math.round(item.price / item.areaTotalM2), item.currency) : 'Sin dato'} /><ComparisonFact label="Fuentes" value={String(item.publicationCount)} /><ComparisonFact label="Presupuesto" value={criteria.maxPrice === undefined || item.price === null ? 'Sin comparar' : item.price <= criteria.maxPrice ? 'Dentro del máximo' : 'Supera el máximo'} /><ComparisonFact label="Frescura" value={freshnessLabel(item.freshness)} /></dl></article>; })}</div><div className="comparisonCaveat"><ShieldCheck size={18} /><span>Ruido, luz, estado y gastos requieren evidencia de la publicación o una visita. Umbral no los completa por su cuenta.</span></div></div></section></div>;
}

function ComparisonFact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function AuthPanel({ mode, resetToken, setMode, onClose, onAuthenticated, onNotice }: { mode: AuthMode; resetToken: string | null; setMode: (mode: AuthMode) => void; onClose: () => void; onAuthenticated: (token: string, user: User) => void; onNotice: (message: string) => void }) {
  const dialogRef = useDialogFocus<HTMLElement>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<string | null>(null);
  const copy = mode === 'register'
    ? { title: 'Creá tu espacio', body: 'Guardá oportunidades, activá monitores y recibí cambios importantes sin perder el hilo.' }
    : mode === 'recover'
      ? { title: 'Recuperá el acceso', body: 'Te enviaremos un enlace de un solo uso si encontramos esa cuenta.' }
      : mode === 'reset'
        ? { title: 'Elegí una nueva contraseña', body: 'El enlace vence pronto y sólo puede usarse una vez.' }
        : { title: 'Volvé a tu espacio', body: 'Retomá tu búsqueda, tus guardados y los cambios que siguen activos.' };
  function switchMode(next: AuthMode) {
    setError(null);
    setCompleted(null);
    setMode(next);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    const data = new FormData(event.currentTarget);
    try {
      if (mode === 'recover') {
        await api('/v1/auth/password/request', {
          method: 'POST', body: JSON.stringify({ email: data.get('email') })
        });
        setCompleted('Si existe una cuenta con ese email, enviamos un enlace seguro para restablecerla.');
        return;
      }
      if (mode === 'reset') {
        if (!resetToken) throw new Error('El enlace para restablecer la contraseña no es válido.');
        await api('/v1/auth/password/reset', {
          method: 'POST', body: JSON.stringify({ token: resetToken, password: data.get('password') })
        });
        window.history.replaceState({}, '', window.location.pathname);
        setCompleted('Contraseña actualizada. Todas las sesiones anteriores fueron cerradas.');
        onNotice('Contraseña actualizada. Ya podés volver a ingresar.');
        return;
      }
      const result = await api<{ token: string; user: User }>(`/v1/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email: data.get('email'), password: data.get('password'), ...(mode === 'register' ? { displayName: data.get('displayName') || undefined } : {}) }) });
      onAuthenticated(result.token, result.user);
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  }
  const action = mode === 'register' ? 'Crear cuenta' : mode === 'login' ? 'Ingresar' : mode === 'recover' ? 'Enviar enlace seguro' : 'Cambiar contraseña';
  return <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section ref={dialogRef} className="authPanel" role="dialog" aria-modal="true" aria-labelledby="auth-title"><div className="panelHeader"><Brand /><button className="iconButton" onClick={onClose} aria-label="Cerrar" autoFocus><X /></button></div><div className="authCopy"><span className="sectionKicker">Tu búsqueda, siempre disponible</span><h2 id="auth-title">{copy.title}</h2><p>{copy.body}</p></div>{completed ? <div className="authComplete" role="status"><Check /><p>{completed}</p><button className="primaryButton" onClick={() => switchMode('login')}>Ir a ingresar</button></div> : <form onSubmit={submit}>{mode === 'register' && <Field label="Nombre"><input name="displayName" minLength={2} autoComplete="name" placeholder="Cómo querés que te llamemos" /></Field>}{mode !== 'reset' && <Field label="Email"><input name="email" type="email" required autoComplete="email" placeholder="vos@ejemplo.com" /></Field>}{mode !== 'recover' && <Field label={mode === 'reset' ? 'Nueva contraseña' : 'Contraseña'}><input name="password" type="password" required minLength={mode === 'login' ? 1 : 10} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? 'Tu contraseña' : 'Mínimo 10 caracteres'} /></Field>}{error && <p className="formError" role="alert">{error}</p>}<button className="primaryButton submitButton" disabled={busy}>{busy ? <><LoaderCircle className="spin" /> Un momento…</> : action}</button></form>}<div className="authModes">{mode !== 'login' && <button className="modeSwitch" onClick={() => switchMode('login')}>Volver a ingresar</button>}{mode === 'login' && <><button className="modeSwitch" onClick={() => switchMode('register')}>¿Primera vez? Creá tu cuenta</button><button className="modeSwitch" onClick={() => switchMode('recover')}>Olvidé mi contraseña</button></>}</div></section></div>;
}

function PageHeading({ kicker, title, body, action }: { kicker: string; title: string; body: string; action?: React.ReactNode }) {
  return <header className="pageHeading"><div><span className="sectionKicker">{kicker}</span><h1>{title}</h1><p>{body}</p></div>{action}</header>;
}

function EmptyState({ icon, title, body, action, onAction }: { icon: React.ReactNode; title: string; body: string; action?: string; onAction?: () => void }) {
  return <div className="emptyState"><span>{icon}</span><h3>{title}</h3><p>{body}</p>{action && onAction && <button className="secondaryButton" onClick={onAction}>{action}</button>}</div>;
}

function LoadingState() {
  return <div className="loadingState" role="status"><LoaderCircle className="spin" /><span>Reuniendo propiedades y publicaciones…</span></div>;
}
