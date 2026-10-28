import { useState } from '@wordpress/element';
import { api } from '../api';
import { href, go } from '../router';
import { useMe } from '../App';
import { useRegister, QUEEN_ACTIVE, QUEEN_STATUS, MATING, label, today } from '../register';
import { Loading, ErrorBox, Button, Modal, Empty, useToast } from '../ui';
import { FieldInput } from '../fields';
import { EntityForm, FieldsModal, History, QueenBadge, StatusBadge, CustomValues } from '../reg-ui';
import { QueenEvaluations } from './Breeding';

export default function Queens( { id } ) {
	const reg = useRegister();
	if ( reg.error ) {
		return <div className="nbs-page"><ErrorBox error={ reg.error } /></div>;
	}
	if ( reg.loading ) {
		return <Loading />;
	}
	return id ? <QueenDetail key={ id } id={ id } /> : <QueenList />;
}

const byCode = ( a, b ) => String( a.code ).localeCompare( String( b.code ), 'sv', { numeric: true } );

function QueenList() {
	const reg = useRegister();
	const me = useMe();
	const [ q, setQ ] = useState( '' );
	const [ status, setStatus ] = useState( 'aktiva' );
	const [ year, setYear ] = useState( '' );
	const [ line, setLine ] = useState( '' );
	const [ editing, setEditing ] = useState( null );
	const [ fieldsOpen, setFieldsOpen ] = useState( false );

	const years = [ ...new Set( reg.queens.map( ( x ) => x.year ).filter( Boolean ) ) ].sort( ( a, b ) => b - a );
	const lines = [ ...new Set( reg.queens.map( ( x ) => x.line_id ).filter( Boolean ) ) ];
	const s = q.trim().toLowerCase();
	const list = reg.queens
		.filter( ( x ) => {
			if ( status === 'aktiva' && ! QUEEN_ACTIVE.includes( x.status ) ) {
				return false;
			}
			if ( status === 'reserv' && ! ( QUEEN_ACTIVE.includes( x.status ) && ! x.colony_id ) ) {
				return false;
			}
			if ( ! [ 'aktiva', 'reserv', 'alla' ].includes( status ) && x.status !== status ) {
				return false;
			}
			if ( year && String( x.year ) !== year ) {
				return false;
			}
			if ( line && x.line_id !== line ) {
				return false;
			}
			if ( s ) {
				const c = reg.colony[ x.colony_id ];
				return ( x.code + ' ' + ( c ? c.code : '' ) ).toLowerCase().includes( s );
			}
			return true;
		} )
		.sort( ( a, b ) => ( b.year || 0 ) - ( a.year || 0 ) || byCode( a, b ) );
	const reserve = reg.queens.filter( ( x ) => QUEEN_ACTIVE.includes( x.status ) && ! x.colony_id ).length;

	return (
		<div className="nbs-page">
			<header className="nbs-page-head">
				<div>
					<h1 className="nbs-h1">Drottningar</h1>
					<p className="nbs-muted">{ reg.queens.filter( ( x ) => QUEEN_ACTIVE.includes( x.status ) ).length } aktiva drottningar{ reserve > 0 && ` · ${ reserve } utan samhälle` }</p>
				</div>
				<div className="nbs-row-actions">
					{ me.can.manage && <Button variant="ghost" onClick={ () => setFieldsOpen( true ) }>Egna fält</Button> }
					{ me.can.write && <Button onClick={ () => setEditing( {} ) }>+ Ny drottning</Button> }
				</div>
			</header>

			<div className="nbs-toolbar">
				<input type="search" className="nbs-search" placeholder="Sök drottning eller samhälle" value={ q } onChange={ ( e ) => setQ( e.target.value ) } aria-label="Sök" />
				<select value={ status } onChange={ ( e ) => setStatus( e.target.value ) } aria-label="Status">
					<option value="aktiva">Aktiva</option>
					<option value="reserv">Utan samhälle</option>
					<option value="alla">Alla</option>
					{ QUEEN_STATUS.map( ( [ k, l ] ) => <option key={ k } value={ k }>{ l }</option> ) }
				</select>
				{ years.length > 1 && (
					<select value={ year } onChange={ ( e ) => setYear( e.target.value ) } aria-label="År">
						<option value="">Alla år</option>
						{ years.map( ( y ) => <option key={ y } value={ y }>{ y }</option> ) }
					</select>
				) }
				{ lines.length > 1 && (
					<select value={ line } onChange={ ( e ) => setLine( e.target.value ) } aria-label="Linje">
						<option value="">Alla linjer</option>
						{ lines.map( ( l ) => <option key={ l } value={ l }>{ reg.itemName( l ) }</option> ) }
					</select>
				) }
			</div>

			{ reg.queens.length === 0 ? (
				<Empty title="Inga drottningar ännu">
					<p>Registrera drottningarna här, eller direkt från ett samhälle med "Sätt in drottning". Märkfärgen räknas fram från kläckningsåret.</p>
					{ me.can.write && <Button onClick={ () => setEditing( {} ) }>+ Ny drottning</Button> }
				</Empty>
			) : list.length === 0 ? (
				<p className="nbs-muted">Inga drottningar matchar filtret.</p>
			) : (
				<div className="nbs-table-wrap">
					<table className="nbs-table">
						<thead><tr><th>Drottning</th><th>Status</th><th>Samhälle</th><th>Linje</th><th>Parning</th><th>Märkt/klippt</th><th>Mor</th></tr></thead>
						<tbody>
							{ list.map( ( x ) => {
								const c = reg.colony[ x.colony_id ];
								return (
									<tr key={ x.id } className={ QUEEN_ACTIVE.includes( x.status ) ? '' : 'is-inactive' }>
										<td><QueenBadge q={ x } /></td>
										<td data-label="Status"><StatusBadge status={ x.status } kind="queen" /></td>
										<td data-label="Samhälle">{ c ? <><a href={ href( 'samhallen/' + c.id ) }>{ c.code }</a>{ reg.apiary[ c.apiary_id ] && <span className="nbs-muted"> · { reg.apiary[ c.apiary_id ].name }</span> }</> : <span className="nbs-muted">–</span> }</td>
										<td data-label="Linje">{ reg.itemName( x.line_id ) || '–' }</td>
										<td data-label="Parning">{ label( MATING, x.mating ) }</td>
										<td data-label="Märkt/klippt">{ [ x.marked && 'märkt', x.clipped && 'klippt' ].filter( Boolean ).join( ', ' ) || '–' }</td>
										<td data-label="Mor">{ reg.queen[ x.mother_id ] ? <QueenBadge q={ reg.queen[ x.mother_id ] } /> : '–' }</td>
									</tr>
								);
							} ) }
						</tbody>
					</table>
				</div>
			) }
			{ editing && <EntityForm type="queen" item={ editing } onClose={ () => setEditing( null ) } onSaved={ ( x ) => go( 'drottningar/' + x.id ) } /> }
			{ fieldsOpen && <FieldsModal type="queen" onClose={ () => setFieldsOpen( false ) } /> }
		</div>
	);
}

function QueenDetail( { id } ) {
	const reg = useRegister();
	const me = useMe();
	const [ editing, setEditing ] = useState( false );
	const [ placing, setPlacing ] = useState( false );
	const q = reg.queen[ id ];
	if ( ! q ) {
		return <div className="nbs-page"><a className="nbs-back" href={ href( 'drottningar' ) }>← Alla drottningar</a><Empty title="Drottningen finns inte" /></div>;
	}
	const c = reg.colony[ q.colony_id ];
	// Stamtavla uppåt (mor, mormor …) och döttrar nedåt.
	const ancestors = [];
	for ( let m = reg.queen[ q.mother_id ]; m && ancestors.length < 5 && ! ancestors.includes( m ); m = reg.queen[ m.mother_id ] ) {
		ancestors.push( m );
	}
	const daughters = reg.queens.filter( ( x ) => x.mother_id === id ).sort( ( a, b ) => ( b.year || 0 ) - ( a.year || 0 ) || byCode( a, b ) );
	const GEN = [ 'Mor', 'Mormor', 'Mormors mor', '4:e led', '5:e led' ];

	return (
		<div className="nbs-page">
			<a className="nbs-back" href={ href( 'drottningar' ) }>← Alla drottningar</a>
			<header className="nbs-page-head">
				<div>
					<p className="nbs-eyebrow">Drottning{ q.mark ? ` · ${ q.mark.name.toLowerCase() } märkfärg` : '' }</p>
					<h1 className="nbs-h1"><QueenBadge q={ q } link={ false } /> <StatusBadge status={ q.status } kind="queen" /></h1>
				</div>
				<div className="nbs-row-actions">
					{ me.can.write && QUEEN_ACTIVE.includes( q.status ) && <Button variant="ghost" onClick={ () => setPlacing( true ) }>{ c ? 'Flytta till annat samhälle' : 'Sätt in i samhälle' }</Button> }
					{ me.can.write && <Button variant="ghost" onClick={ () => setEditing( true ) }>Redigera</Button> }
				</div>
			</header>

			<div className="nbs-grid">
				<section className="nbs-card">
					<h2 className="nbs-h2">Uppgifter</h2>
					<dl className="nbs-dl">
						<div><dt>Samhälle</dt><dd>{ c ? <><a href={ href( 'samhallen/' + c.id ) }>{ c.code }</a>{ reg.apiary[ c.apiary_id ] && <> · <a href={ href( 'bigardar/' + c.apiary_id ) }>{ reg.apiary[ c.apiary_id ].name }</a></> }</> : 'Inget' }</dd></div>
						<div><dt>Kläckningsår</dt><dd>{ q.year || '–' }</dd></div>
						<div><dt>Märkfärg</dt><dd>{ q.mark ? q.mark.name : '–' }{ q.mark && ! q.marked ? ' (inte märkt)' : '' }</dd></div>
						<div><dt>Linje</dt><dd>{ reg.itemName( q.line_id ) || '–' }</dd></div>
						<div><dt>Parning</dt><dd>{ label( MATING, q.mating ) }{ q.mating_place ? `, ${ q.mating_place }` : '' }</dd></div>
						<div><dt>Vingklippt</dt><dd>{ q.clipped ? 'Ja' : 'Nej' }</dd></div>
					</dl>
					<CustomValues fields={ reg.fields.queen } data={ q.data } refs={ reg.refs } />
					{ q.notes && <p className="nbs-notes">{ q.notes }</p> }
				</section>
				<section className="nbs-card">
					<h2 className="nbs-h2">Stamtavla</h2>
					{ ancestors.length === 0 && daughters.length === 0 && <p className="nbs-muted">Ingen mor eller döttrar registrerade. Ange mor under Redigera.</p> }
					{ ancestors.length > 0 && (
						<ol className="nbs-pedigree">
							{ ancestors.map( ( m, i ) => (
								<li key={ m.id }><span className="nbs-muted">{ GEN[ i ] }</span> <QueenBadge q={ m } />{ m.line_id && <span className="nbs-muted"> · { reg.itemName( m.line_id ) }</span> }</li>
							) ) }
						</ol>
					) }
					{ daughters.length > 0 && (
						<>
							<h3 className="nbs-h3">Döttrar ({ daughters.length })</h3>
							<ul className="nbs-daughters">
								{ daughters.map( ( d ) => <li key={ d.id }><QueenBadge q={ d } /> <StatusBadge status={ d.status } kind="queen" /></li> ) }
							</ul>
						</>
					) }
				</section>
			</div>

			<QueenEvaluations queen={ q } />

			<History filter={ { queen_id: id } } ctx="queen" stamp={ q.updated_at + q.colony_id + q.status } />

			{ editing && <EntityForm type="queen" item={ q } onClose={ ( deleted ) => ( setEditing( false ), deleted && go( 'drottningar' ) ) } /> }
			{ placing && <PlaceModal q={ q } onClose={ () => setPlacing( false ) } /> }
		</div>
	);
}

/** Sätter in drottningen i ett samhälle (via samhällets drottningbyte). */
function PlaceModal( { q, onClose } ) {
	const reg = useRegister();
	const toast = useToast();
	const [ colony, setColony ] = useState( '' );
	const [ oldStatus, setOldStatus ] = useState( 'ersatt' );
	const [ date, setDate ] = useState( today() );
	const [ busy, setBusy ] = useState( false );
	const [ err, setErr ] = useState( null );
	const options = reg.activeColonies
		.filter( ( c ) => c.id !== q.colony_id )
		.sort( ( a, b ) => !! a.queen_id - !! b.queen_id || byCode( a, b ) )
		.map( ( c ) => [ c.id, `${ c.code }${ reg.apiary[ c.apiary_id ] ? ' – ' + reg.apiary[ c.apiary_id ].name : '' }${ c.queen_id ? '' : ' (drottninglöst)' }` ] );
	const target = reg.colony[ colony ];
	const run = async () => {
		setBusy( true );
		setErr( null );
		try {
			await api( `colonies/${ colony }/queen`, { method: 'POST', body: { queen_id: q.id, old_status: oldStatus, date } } );
			await reg.reload();
			toast( 'Drottningen sattes in.' );
			onClose();
		} catch ( e ) {
			setErr( e );
			setBusy( false );
		}
	};
	return (
		<Modal
			title={ `Sätt in ${ q.code }` }
			onClose={ onClose }
			footer={
				<>
					<span className="nbs-spacer" />
					<Button variant="ghost" onClick={ onClose }>Avbryt</Button>
					<Button onClick={ run } disabled={ busy || ! colony }>{ busy ? 'Sparar…' : 'Sätt in' }</Button>
				</>
			}
		>
			<div className="nbs-form">
				<ErrorBox error={ err } />
				<FieldInput field={ { key: 'pl_colony', label: 'Samhälle', type: 'select', options } } value={ colony } onChange={ setColony } />
				{ target && target.queen_id && reg.queen[ target.queen_id ] && (
					<FieldInput field={ { key: 'pl_old', label: `Nuvarande drottning ${ reg.queen[ target.queen_id ].code } blir`, type: 'select', noEmpty: true, options: [ ...QUEEN_STATUS.filter( ( s ) => ! QUEEN_ACTIVE.includes( s[ 0 ] ) ), [ 'parad', 'Kvar som reserv' ] ] } } value={ oldStatus } onChange={ setOldStatus } />
				) }
				<div className="nbs-field">
					<label htmlFor="nbs-pl-date">Datum</label>
					<input id="nbs-pl-date" type="date" value={ date } onChange={ ( e ) => setDate( e.target.value ) } />
				</div>
			</div>
		</Modal>
	);
}
