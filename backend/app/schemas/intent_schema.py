"""
Flexible intent schema that supports both single and multi-command intents.
This schema is designed to be permissive - the LLM can output various fields
and we'll handle them gracefully on the frontend.
"""
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field


class IntentCommand(BaseModel):
    """A single intent command that can be incomplete (not all fields required)."""
    # Core targeting
    targets: Optional[List[str]] = None
    
    # Actions - now includes 'help' and other variations
    action: Optional[str] = None
    
    # Movement and positioning
    formation: Optional[str] = None
    direction: Optional[str] = None
    speed: Optional[int] = Field(None, ge=0, le=10)
    path: Optional[List[List[float]]] = None
    zone: Optional[Dict[str, Any]] = None
    
    # Deployment
    deployCount: Optional[int] = Field(None, ge=1)  # No upper limit
    deployFormation: Optional[str] = None
    
    # Waypoint navigation
    waypointTargets: Optional[List[str]] = None
    cycleWaypoints: Optional[bool] = None
    pathCycle: Optional[bool] = None  # Alternative name for cycling
    
    # Relative movement - accept both formats
    relativeMove: Optional[Dict[str, Any]] = None
    relativeMovement: Optional[Dict[str, Any]] = None  # Can be {x,y,z} or {direction,distance}
    
    # Help/rally commands
    helpTarget: Optional[str] = None
    targetSquad: Optional[str] = None  # Alternative name
    
    # Spacing and formation
    maintainSpacing: Optional[bool] = None
    
    # Allow any additional fields the LLM might generate
    class Config:
        extra = "allow"


class MultiIntent(BaseModel):
    """Multiple commands to be executed."""
    type: Literal["multi"] = "multi"
    commands: List[IntentCommand]
    
    class Config:
        extra = "allow"


# The actual schema we'll use - can be either a single command or multi
FlexibleIntent = Union[IntentCommand, MultiIntent]