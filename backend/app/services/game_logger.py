import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional


class GameLogger:
    def __init__(self, log_dir: str = "game_logs"):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(exist_ok=True)
        self.current_log_file = self._get_next_log_file()
        self.session_start = datetime.now()
        
        # Write session header
        self._write_header()
    
    def _get_next_log_file(self) -> Path:
        """Find the next available log file number."""
        existing_logs = list(self.log_dir.glob("*.log"))
        if not existing_logs:
            return self.log_dir / "1.log"
        
        # Find highest number
        max_num = 0
        for log_file in existing_logs:
            try:
                num = int(log_file.stem)
                max_num = max(max_num, num)
            except ValueError:
                continue
        
        return self.log_dir / f"{max_num + 1}.log"
    
    def _write_header(self):
        """Write session header to log file."""
        with open(self.current_log_file, 'w') as f:
            f.write("=" * 80 + "\n")
            f.write(f"GAME SESSION LOG - {self.session_start.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write("=" * 80 + "\n\n")
    
    def log_whisper_transcription(self, text: str, partial: bool = False):
        """Log a whisper transcription."""
        timestamp = datetime.now().strftime('%H:%M:%S.%f')[:-3]
        log_type = "WHISPER_PARTIAL" if partial else "WHISPER_FINAL"
        
        with open(self.current_log_file, 'a', encoding='utf-8') as f:
            f.write(f"[{timestamp}] {log_type}:\n")
            f.write(f"  Text: {text}\n")
            f.write("\n")
    
    def log_intent_request(self, text: str, context: Optional[Dict[str, Any]] = None):
        """Log an intent request being sent to LLM."""
        timestamp = datetime.now().strftime('%H:%M:%S.%f')[:-3]
        
        with open(self.current_log_file, 'a', encoding='utf-8') as f:
            f.write(f"[{timestamp}] INTENT_REQUEST:\n")
            f.write(f"  Command: {text}\n")
            if context:
                # Log a summary of the context
                f.write(f"  Context Summary:\n")
                if 'squads' in context:
                    squad_info = []
                    for name, info in context.get('squads', {}).items():
                        if isinstance(info, dict) and info.get('alive'):
                            squad_info.append(f"{name}({info.get('shipCount', 0)})")
                    f.write(f"    Active Squads: {', '.join(squad_info)}\n")
                
                if 'enemyCount' in context:
                    f.write(f"    Enemy Count: {context['enemyCount']}\n")
                
                if 'waveNumber' in context:
                    f.write(f"    Wave: {context['waveNumber']}\n")
            f.write("\n")
    
    def log_intent_response(self, intent: Dict[str, Any], success: bool = True, error: Optional[str] = None):
        """Log the LLM's intent response."""
        timestamp = datetime.now().strftime('%H:%M:%S.%f')[:-3]
        
        with open(self.current_log_file, 'a', encoding='utf-8') as f:
            if success:
                f.write(f"[{timestamp}] INTENT_RESPONSE (SUCCESS):\n")
                f.write(f"  Intent: {json.dumps(intent, indent=4)}\n")
            else:
                f.write(f"[{timestamp}] INTENT_RESPONSE (ERROR):\n")
                f.write(f"  Error: {error}\n")
                if intent:
                    f.write(f"  Raw Response: {intent}\n")
            f.write("\n")
    
    def log_game_event(self, event_type: str, data: Any):
        """Log a general game event."""
        timestamp = datetime.now().strftime('%H:%M:%S.%f')[:-3]
        
        with open(self.current_log_file, 'a', encoding='utf-8') as f:
            f.write(f"[{timestamp}] GAME_EVENT - {event_type}:\n")
            if isinstance(data, dict):
                f.write(f"  {json.dumps(data, indent=4)}\n")
            else:
                f.write(f"  {data}\n")
            f.write("\n")
    
    def get_log_path(self) -> str:
        """Get the current log file path."""
        return str(self.current_log_file)


# Global logger instance
_logger: Optional[GameLogger] = None


def get_game_logger() -> GameLogger:
    """Get or create the global game logger."""
    global _logger
    if _logger is None:
        _logger = GameLogger()
    return _logger
