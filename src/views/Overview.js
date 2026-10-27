import { api } from '../api';
import { href } from '../router';
import { useLoad, Loading, ErrorBox, Button, useToast } from '../ui';
import { useMe } from '../App';
import { useState } from '@wordpress/element';

const PHASES = [
	[ 0, 'Grund och egna listor', 'Klar' ],
	[ 1, 'Bigårdar, kupor, samhällen och drottningar', '' ],
	[ 2, 'Lager och material', '' ],
	[ 3, 'Skötselkort och besök', '' ],
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
									<li key={ n } className={ n === 0 ? 'is-done' : '' }>
										<span className="nbs-phase-n">{ n }</span>
										<span>{ label }</span>
										{ n === 0 && <span className="nbs-badge is-ok">Klar</span> }
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
