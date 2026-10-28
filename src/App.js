import { createContext, useContext } from '@wordpress/element';
import { api, config } from './api';
import { useRoute, href } from './router';
import { ToastProvider, useLoad, Loading, ErrorBox } from './ui';
import Overview from './views/Overview';
import Lists from './views/Lists';
import Settings from './views/Settings';
import Apiaries from './views/Apiaries';
import Colonies from './views/Colonies';
import Queens from './views/Queens';
import Stock from './views/Stock';
import Visits from './views/Visits';
import { RegisterProvider } from './register';

export const MeCtx = createContext( null );
export const useMe = () => useContext( MeCtx );

/** Moduler i menyn. De som inte är byggda än visas som "kommer". */
export const MODULES = [
	{ key: '', label: 'Översikt', short: 'Hem', icon: '◎' },
	{ key: 'besok', label: 'Besök', icon: '✓' },
	{ key: 'bigardar', label: 'Bigårdar', icon: '⌂' },
	{ key: 'samhallen', label: 'Samhällen', icon: '⬡' },
	{ key: 'drottningar', label: 'Drottningar', icon: '♛', desktopOnly: true },
	{ key: 'lager', label: 'Lager', icon: '▤' },
	{ key: 'driftplan', label: 'Driftplan', icon: '▦', phase: 4 },
	{ key: 'listor', label: 'Listor', icon: '☰', desktopOnly: true },
	{ key: 'installningar', label: 'Inställningar', short: 'Mer', icon: '⚙' },
];

function Coming( { mod } ) {
	return (
		<div className="nbs-page">
			<h1 className="nbs-h1">{ mod.label }</h1>
			<div className="nbs-empty">
				<h3>Kommer i fas { mod.phase }</h3>
				<p>Den här delen byggs enligt planen. Börja gärna med att fylla i dina listor, så finns material, kuptyper, linjer och foder på plats när modulen kommer.</p>
				<a className="nbs-btn is-primary" href={ href( 'listor' ) }>Till listorna</a>
			</div>
		</div>
	);
}

function Shell() {
	const route = useRoute();
	const [ me, error ] = useLoad( () => api( 'me' ) );
	if ( error ) {
		return <div className="nbs-page"><ErrorBox error={ error } /></div>;
	}
	if ( ! me ) {
		return <Loading />;
	}
	const current = MODULES.find( ( m ) => m.key === ( route[ 0 ] || '' ) ) || MODULES[ 0 ];
	let page;
	if ( current.key === 'bigardar' ) {
		page = <Apiaries id={ route[ 1 ] } sub={ route[ 2 ] } />;
	} else if ( current.key === 'samhallen' ) {
		page = <Colonies id={ route[ 1 ] } />;
	} else if ( current.key === 'besok' ) {
		page = <Visits route={ route.slice( 1 ) } />;
	} else if ( current.key === 'lager' ) {
		page = <Stock route={ route.slice( 1 ) } />;
	} else if ( current.key === 'drottningar' ) {
		page = <Queens id={ route[ 1 ] } />;
	} else if ( current.key === 'listor' ) {
		page = <Lists listId={ route[ 1 ] } />;
	} else if ( current.key === 'installningar' ) {
		page = <Settings tab={ route[ 1 ] } />;
	} else if ( current.phase ) {
		page = <Coming mod={ current } />;
	} else {
		page = <Overview />;
	}
	return (
		<MeCtx.Provider value={ me }>
			<RegisterProvider>
			<div className={ `nbs-app${ config.base === 'admin' ? ' is-admin' : '' }` }>
				<header className="nbs-top">
					<a className="nbs-brand" href={ href( '' ) }>
						<span className="nbs-brand-mark" aria-hidden="true">⬡</span>
						<span><strong>Skötsel</strong><small>{ me.org ? me.org.name : '' }</small></span>
					</a>
					<div className="nbs-top-right">
						<span className="nbs-user">{ me.user.name }</span>
						{ config.base !== 'admin' && <a className="nbs-top-link" href={ config.home }>Till webbplatsen</a> }
						{ config.base !== 'admin' && <a className="nbs-top-link" href={ config.logout }>Logga ut</a> }
					</div>
				</header>
				<nav className="nbs-nav" aria-label="Huvudmeny">
					{ MODULES.map( ( m ) => (
						<a key={ m.key || 'home' } href={ href( m.key ) } className={ `nbs-nav-item${ m === current ? ' is-active' : '' }${ m.phase ? ' is-coming' : '' }${ m.desktopOnly ? ' is-desktop-only' : '' }` } aria-current={ m === current ? 'page' : undefined } aria-label={ m.label }>
							<span className="nbs-nav-icon" aria-hidden="true">{ m.icon }</span>
							<span className="nbs-nav-label">{ m.label }</span>
							<span className="nbs-nav-short" aria-hidden="true">{ m.short || m.label }</span>
						</a>
					) ) }
				</nav>
				<main className="nbs-main">{ page }</main>
			</div>
			</RegisterProvider>
		</MeCtx.Provider>
	);
}

export default function App() {
	return (
		<ToastProvider>
			<Shell />
		</ToastProvider>
	);
}
