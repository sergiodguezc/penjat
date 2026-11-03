import type { Language } from '../../shared/game'
import { routeClick } from '../navigation/links'
import type { Route } from '../routing'

type Props = {
  language: Language
  onNavigate?: (route: Route) => void
}

const copy = {
  ca: {
    title: 'Com es juga al Penjat?',
    titleParts: ['Com es ', 'juga', ' al Penjat?'],
    eyebrow: 'Guia ràpida',
    tryIt: 'Prova-ho',
    intro: 'Endevina la paraula lletra a lletra abans d’arribar als sis errors.',
    rules: {
      title: 'Regles',
      items: ['Endevina lletres per revelar la paraula.', 'Les lletres correctes es mostren i les incorrectes compten com un error.', 'Completa la paraula per resoldre-la.', 'En arribar als sis errors, quedes fora, tret que et perdonin.'],
    },
    multiplayer: {
      title: 'Multijugador',
      items: ['Crea una sala o uneix-t’hi amb un codi.', 'A cada torn, un jugador tria la paraula secreta i la resta intenten endevinar-la.', 'Qui l’ha triada pot observar el progrés de cada jugador, però no juga aquella paraula.', 'El torn acaba quan tots els qui endevinen han resolt la paraula o han quedat fora.'],
    },
    rotation: {
      title: 'Rondes i torns',
      items: ['Una ronda completa és quan cada jugador ha triat una paraula una vegada.', 'El torn passa al jugador següent segons l’ordre de la partida; si algú marxa, s’omet.', 'Amb 1, 3 o 5 rondes, la partida acaba quan s’han completat els torns previstos.'],
    },
    scoring: {
      title: 'Puntuació',
      items: ['Només puntuen els jugadors que resolen la paraula; qui l’ha triada rep +0.', 'Els resolts van davant dels no resolts. Entre els resolts, menys errors és millor i el temps resol els empats.', 'Els punts depenen del nombre de jugadors que endevinen: amb 3, el millor rep +3, el segon +2 i el tercer +1. Els no resolts reben +0.', 'Un jugador perdonat que resol la paraula encara pot puntuar; si queda eliminat, rep +0. La classificació mostra els punts acumulats de la partida.', 'Els jugadors amb els mateixos punts comparteixen lloc a la classificació.'],
    },
    forgiveness: {
      title: 'Perdó',
      items: ['En arribar al sisè error, s’envia una petició de perdó a qui ha triat la paraula.', 'La pot concedir o denegar.', 'Si la concedeix, continues amb els errors que ja tens; un altre error t’elimina.', 'Si resols la paraula després del perdó, puntues segons la classificació.'],
    },
    leaving: {
      title: 'Si marxes de la sala',
      items: ['Si perds la connexió, tens dos minuts per tornar-hi i continuar amb els teus punts.', 'Si marxes, no participes en els torns futurs ni en la classificació activa.', 'Els punts acumulats es conserven i apareixen a «Ja no són a la sala».'],
    },
    matchEnd: {
      title: 'Final de la partida',
      items: ['La classificació final mostra els punts de tots els participants, també dels qui han marxat.', 'Qui té més punts guanya; si diversos jugadors empaten, comparteixen el primer lloc.', 'La revenja comença quan tots els jugadors que continuen a la sala la demanen.'],
    },
    local: {
      title: 'Passa el mòbil',
      items: ['Per jugar en grup amb un sol mòbil: escriviu els noms en l’ordre en què seieu.', 'Qui tria la paraula l’escriu en secret; després el mòbil passa d’un jugador a l’altre i cadascú l’endevina pel seu compte.', 'Abans de cada torn, una pantalla diu a qui s’ha de passar el mòbil: ningú més ha de mirar.', 'La puntuació i el perdó són els mateixos que en el multijugador. La partida es desa en aquest navegador i, un cop preparat, el joc funciona sense internet.'],
    },
    learn: {
      title: 'Aprèn vocabulari',
      items: ['Es juga en solitari, per unitats temàtiques de 12 paraules.', 'Cada paraula té una pista en castellà.', 'Quan acabes una paraula, veus el significat, un exemple i la traducció.', 'El progrés es desa en aquest navegador: pots continuar més tard, repassar les paraules fallades o tornar a jugar la unitat.'],
    },
    daily: {
      title: 'Paraula del dia',
      items: ['Cada dia hi ha una paraula catalana nova, la mateixa per a tothom.', 'Tens sis errors i un sol intent per dia; el progrés es desa en aquest navegador.', 'Quan acabes, veus el significat i pots compartir el resultat sense revelar la paraula.'],
    },
  },
  es: {
    title: '¿Cómo se juega a Penjat?',
    titleParts: ['¿Cómo se ', 'juega', ' a Penjat?'],
    eyebrow: 'Guía rápida',
    tryIt: 'Pruébalo',
    intro: 'Adivina la palabra letra a letra antes de llegar a seis errores.',
    rules: {
      title: 'Reglas',
      items: ['Adivina letras para revelar la palabra.', 'Las letras correctas se muestran y las incorrectas cuentan como un error.', 'Completa la palabra para resolverla.', 'Al llegar a seis errores, quedas fuera, salvo que te perdonen.'],
    },
    multiplayer: {
      title: 'Multijugador',
      items: ['Crea una sala o únete con un código.', 'En cada turno, un jugador elige la palabra secreta y los demás intentan adivinarla.', 'Quien la ha elegido puede observar el progreso de cada jugador, pero no juega esa palabra.', 'El turno termina cuando todos los que adivinan han resuelto la palabra o han quedado fuera.'],
    },
    rotation: {
      title: 'Rondas y turnos',
      items: ['Una ronda completa es cuando cada jugador ha elegido una palabra una vez.', 'El turno pasa al siguiente jugador según el orden de la partida; si alguien se va, se omite.', 'Con 1, 3 o 5 rondas, la partida termina al completar los turnos previstos.'],
    },
    scoring: {
      title: 'Puntuación',
      items: ['Solo puntúan quienes resuelven la palabra; quien la ha elegido recibe +0.', 'Los jugadores que la resuelven van delante de quienes no lo hacen. Entre los primeros, menos errores es mejor y el tiempo resuelve los empates.', 'Los puntos dependen del número de jugadores que adivinan: con 3, el mejor recibe +3, el segundo +2 y el tercero +1. Quienes no la resuelven reciben +0.', 'Un jugador perdonado que resuelve la palabra aún puede puntuar; si queda eliminado, recibe +0. La clasificación muestra los puntos acumulados de la partida.', 'Los jugadores con los mismos puntos comparten puesto en la clasificación.'],
    },
    forgiveness: {
      title: 'Perdón',
      items: ['Al llegar al sexto error, se envía una petición de perdón a quien ha elegido la palabra.', 'Puede concederla o denegarla.', 'Si la concede, continúas con los errores que ya tienes; otro error te elimina.', 'Si resuelves la palabra después del perdón, puntúas según la clasificación.'],
    },
    leaving: {
      title: 'Si sales de la sala',
      items: ['Si pierdes la conexión, tienes dos minutos para volver y seguir con tus puntos.', 'Si te vas, no participas en los turnos futuros ni en la clasificación activa.', 'Conservas los puntos acumulados, que aparecen en «Ya no están en la sala».'],
    },
    matchEnd: {
      title: 'Final de la partida',
      items: ['La clasificación final muestra los puntos de todos los participantes, también de quienes se han ido.', 'Gana quien tiene más puntos; si varios jugadores empatan, comparten el primer puesto.', 'La revancha empieza cuando todos los jugadores que siguen en la sala la piden.'],
    },
    local: {
      title: 'Pasa el móvil',
      items: ['Para jugar en grupo con un solo móvil: escribid los nombres en el orden en que estáis sentados.', 'Quien elige la palabra la escribe en secreto; después el móvil pasa de un jugador a otro y cada uno la adivina por su cuenta.', 'Antes de cada turno, una pantalla indica a quién hay que pasar el móvil: nadie más debe mirar.', 'La puntuación y el perdón son los mismos que en el multijugador. La partida se guarda en este navegador y, una vez preparado, el juego funciona sin internet.'],
    },
    learn: {
      title: 'Aprende vocabulario',
      items: ['Se juega en solitario, por unidades temáticas de 12 palabras.', 'Cada palabra tiene una pista en español.', 'Al terminar una palabra, ves el significado, un ejemplo y la traducción.', 'El progreso se guarda en este navegador: puedes continuar más tarde, repasar las palabras falladas o volver a jugar la unidad.'],
    },
    daily: {
      title: 'Palabra del día',
      items: ['Cada día hay una palabra catalana nueva, la misma para todos.', 'Tienes seis errores y un solo intento al día; el progreso se guarda en este navegador.', 'Al terminar, ves el significado y puedes compartir el resultado sin revelar la palabra.'],
    },
  },
} satisfies Record<Language, {
  title: string
  titleParts: [string, string, string]
  eyebrow: string
  tryIt: string
  intro: string
  rules: { title: string; items: string[] }
  multiplayer: { title: string; items: string[] }
  rotation: { title: string; items: string[] }
  scoring: { title: string; items: string[] }
  forgiveness: { title: string; items: string[] }
  leaving: { title: string; items: string[] }
  matchEnd: { title: string; items: string[] }
  local: { title: string; items: string[] }
  daily: { title: string; items: string[] }
  learn: { title: string; items: string[] }
}>

type HelpSection = { title: string; items: string[] }

export function HowToPlayPage({ language, onNavigate }: Props) {
  const t = copy[language]
  const section = (item: HelpSection, tone = '', link?: { href: string; route: Route }) => <section className={`howto-section${tone ? ` howto-section--${tone}` : ''}`} key={item.title}>
    <h2>{item.title}</h2>
    <ul>{item.items.map((text) => <li key={text}>{text}</li>)}</ul>
    {link && <a className="howto-link" href={link.href} onClick={routeClick(onNavigate && (() => onNavigate(link.route)))}>{t.tryIt}<span aria-hidden="true"> →</span></a>}
  </section>

  return <main className="howto-page" lang={language}>
    <div className="howto-shell">
      <header className="page-head howto-header">
        <p className="page-eyebrow page-eyebrow--magrana">{t.eyebrow}</p>
        <h1>{t.titleParts[0]}<em>{t.titleParts[1]}</em>{t.titleParts[2]}</h1>
        <p className="page-lede">{t.intro}</p>
      </header>

      <article className="howto-card">
        <section className="howto-steps" aria-labelledby="howto-rules-title">
          <h2 id="howto-rules-title">{t.rules.title}</h2>
          <ol>{t.rules.items.map((item, index) => <li key={item}><span className="howto-step-number" aria-hidden="true">{index + 1}</span><p>{item}</p></li>)}</ol>
        </section>
        <div className="howto-grid">
          {section(t.multiplayer, 'mar', { href: '/multijugador', route: '/multijugador/' })}
          {section(t.rotation)}
          {section(t.scoring, 'ink')}
          {section(t.forgiveness)}
          {section(t.leaving)}
          {section(t.matchEnd)}
          {section(t.local, 'mar', { href: '/passa-el-mobil', route: '/passa-el-mobil/' })}
          {section(t.learn, 'oliva', { href: '/aprendre', route: '/aprendre/' })}
          {section(t.daily, 'safra', { href: '/paraula-del-dia', route: '/paraula-del-dia/' })}
        </div>
      </article>
    </div>
  </main>
}
