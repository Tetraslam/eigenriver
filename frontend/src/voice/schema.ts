export type Target = string; // Now dynamic: "alpha", "all", "top_right_squads", etc.
export type Action = "flank"|"pincer"|"hold"|"advance"|"screen"|"intercept"|"retreat"|"patrol"|"rally"|"escort"|"attack"|"defend"|"regroup"|"focus_fire"|"deploy"|"move"|"help"|"cycle";
export type Formation = "none"|"wall"|"wedge"|"sphere"|"swarm"|"column"|"line"|"diamond"|"spread"|"circle"|"triangle"|"square";
export type Direction = "left"|"right"|"center"|"north"|"south"|"east"|"west"|"up"|"down"|"bearing"|"vector"|"none"|"towards_enemies"|"away_from_enemies"|"forward"|"backward"|"top_right"|"top_left"|"bottom_right"|"bottom_left";

export type Zone = { type: "sphere"; center: [number,number,number]; r: number };

export type RelativeMove = {
  direction: "left"|"right"|"forward"|"backward";
  distance: number;
};

export type SingleIntent = {
  targets: Target[];  // Can be squad names or descriptions like "top_right_squads"
  action: Action;
  formation?: Formation;
  direction?: Direction;
  speed?: number;
  path?: [number,number,number][];
  zone?: Zone;
  deployCount?: number;
  deployFormation?: "circle"|"triangle"|"square";  // For deployment patterns
  waypointTargets?: string[];  // Multiple waypoints for cycling
  relativeMove?: RelativeMove;
  helpTarget?: string;  // Squad to help/assist
  maintainSpacing?: boolean;  // Keep squads separated
  cycleWaypoints?: boolean;  // Keep cycling through waypoints
};

export type Intent = SingleIntent | { type: 'multi'; commands: SingleIntent[] };


