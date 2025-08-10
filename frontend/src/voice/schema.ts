export type Target = "alpha"|"bravo"|"charlie"|"all"|"carriers"|"interceptors";
export type Action = "flank"|"pincer"|"hold"|"advance"|"screen"|"intercept"|"retreat"|"patrol"|"rally"|"escort";
export type Formation = "none"|"wall"|"wedge"|"sphere"|"swarm"|"column";
export type Direction = "left"|"right"|"center"|"bearing"|"vector"|"none";

export type Zone = { type: "sphere"; center: [number,number,number]; r: number };

export type SingleIntent = {
  targets: Target[];
  action: Action;
  formation: Formation;
  direction: Direction;
  speed: number;
  path?: [number,number,number][];
  zone?: Zone;
};

export type Intent = SingleIntent | { type: 'multi'; commands: SingleIntent[] };


