import { api } from '../api';
import { href } from '../router';
import { useLoad, Loading, ErrorBox, Button, useToast } from '../ui';
import { useMe } from '../App';
import { useState } from '@wordpress/element';
import { useRegister, QUEEN_ACTIVE } from '../register';

const PHASES = [
	[ 0, 'Grund och egna listor', 'Klar' ],
	[ 1, 'Bigårdar, kupor, samhällen och drottningar', 'Klar' ],
	[ 2, 'Lager och material', 'Klar' ],
	[ 3, 'Skötselkort och besök', 'Klar' ],
	[ 4, 'Driftplan och uppgifter', '' ],
	[ 5, 'Bihälsa och foder', '' ],
	[ 6, 'Honung och spårbarhet', '' ],
	[ 7, 'Avel och drottningodling', '' ],
	[ 8, 'Ekonomi', '' ],
	[ 9, 'Fält, offline och export', '' ],
];

export default function Overview() {
	const me = useMe();
	const toast = useToast();
	const [ lists, error, reload ] = useLoad( () => api( 'lists' ) );
	const [ busy, setBusy ] = useState( false );
	const filled = lists ? lists.filter( ( l ) => l.count > 0 ).length : 0;

	const importStarter = async () => {
		setBusy( true );
		try {
			const res = await api( 'starter', { method: 'POST' } );
			toast( res.added ? `${ res.added } poster lades till.` : 'Startpaketet fanns redan.' );
			reload();
		} catch ( e ) {
			toast( e.message, 'error' );
		}
		setBusy( false );
	};

	return (
		<div className="nbs-page">
			<p className="nbs-eyebrow">{ me.org && me.org.name }</p>
			<h1 className="nbs-h1">Hej { me.user.name.split( ' ' )[ 0 ] }!</h1>
			<ErrorBox error={ error } />
			{ ! lists && ! error && <Loading /> }
			{ lists && (
				<div className="nbs-grid">
					<RegisterCard />
					<section className="nbs-card">
						<h2 className="nbs-h2">Dina listor</h2>
						<p>{ filled } av { lists.length } listor har innehåll. Listorna är grunden för resten av systemet: material, kuptyper, linjer, foder, behandlingar, kategorier och egna listor med egna fält.</p>
						<div className="nbs-row-actions">
							<a className="nbs-btn is-primary" href={ href( 'listor' ) }>Öppna listorna</a>
							{ me.can.manage && filled < 3 && (
								<Button variant="ghost" onClick={ importStarter } disabled={ busy }>
									{ busy ? 'Lägger in…' : 'Lägg in startpaket från driftplanen' }
								</Button>
							) }
						</div>
					</section>
					<section className="nbs-card">
						<h2 className="nbs-h2">Byggs i faser</h2>
						<ol className="nbs-phases">
							{ PHASES.map( ( [ n, label ] ) => {
								return (
									<li key={ n } className={ n <= 3 ? 'is-done' : '' }>
										<span className="nbs-phase-n">{ n }</span>
										<span>{ label }</span>
										{ n <= 3 && <span className="nbs-badge is-ok">Klar</span> }
									</li>
								);
							} ) }
						</ol>
					</section>
				</div>
			) }
		</div>
	);
}

function RegisterCard() {
	const reg = useRegister();
	if ( reg.loading || reg.error ) {
		return null;
	}
	const active = reg.apiaries.filter( ( a ) => a.active );
	const queenless = reg.activeColonies.filter( ( c ) => ! c.queen_id ).length;
	const queens = reg.queens.filter( ( q ) => QUEEN_ACTIVE.includes( q.status ) ).length;
	return (
		<section className="nbs-card">
			<h2 className="nbs-h2">Biodlingen just nu</h2>
			<ul className="nbs-stats">
				<li><a href={ href( 'bigardar' ) }><strong>{ active.length }</strong> bigårdar</a></li>
				<li><a href={ href( 'samhallen' ) }><strong>{ reg.activeColonies.length }</strong> samhällen</a></li>
				<li><a href={ href( 'drottningar' ) }><strong>{ queens }</strong> drottningar</a></li>
				<li><a href={ href( 'samhallen/kupor' ) }><strong>{ reg.hives.filter( ( h ) => h.active ).length }</strong> kupor</a></li>
			</ul>
			{ queenless > 0 && <p className="nbs-warn">{ queenless } { queenless === 1 ? 'samhälle saknar' : 'samhällen saknar' } registrerad drottning.</p> }
			{ active.length === 0 && <p>Börja med <a href={ href( 'bigardar' ) }>bigårdarna</a> – de 13 platserna från logistikplanen kan hämtas med en knapp.</p> }
		</section>
	);
}