export type Target = "alpha"|"bravo"|"charlie"|"all"|"carriers"|"interceptors";
export type Action = "flank"|"pincer"|"hold"|"advance"|"screen"|"intercept"|"retreat"|"patrol"|"rally"|"escort"|"attack"|"defend"|"regroup"|"focus_fire"|"deploy";
export type Formation = "none"|"wall"|"wedge"|"sphere"|"swarm"|"column"|"line"|"diamond";
export type Direction = "left"|"right"|"center"|"north"|"south"|"east"|"west"|"bearing"|"vector"|"none"|"towards_enemies"|"away_from_enemies";

export type Zone = { type: "sphere"; center: [number,number,number]; r: number };

export type SingleIntent = {
  targets: Target[];
  action: Action;
  formation: Formation;
  direction: Direction;
  speed: number;
  path?: [number,number,number][];
  zone?: Zone;
  deployCount?: number;
};

export type Intent = SingleIntent | { type: 'multi'; commands: SingleIntent[] };


