/**
 * useGanttDragDrop — Native drag-and-drop for Gantt blocks.
 *
 * Manages drag state, undo stack (max 20), and proposed move detection.
 * Does NOT mutate blocks — returns proposed move for DeviationPanel confirmation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Block, EMachine } from '../../../lib/engine';
import { S0, S1 } from '../../../lib/engine';

export interface DragState {
  isDragging: boolean;
  block: Block | null;
  offsetX: number;
  offsetY: number;
  ghostX: number;
  ghostY: number;
}

export interface ProposedMove {
  block: Block;
  toMachineId: string;
  toStartMin: number;
  isFrozen: boolean;
}

interface UndoEntry {
  description: string;
  timestamp: number;
}

const MAX_UNDO = 20;
const RANGE = S1 - S0;

export function useGanttDragDrop(machines: EMachine[], rowHeight: number, ppm: number) {
  const [drag, setDrag] = useState<DragState>({
    isDragging: false,
    block: null,
    offsetX: 0,
    offsetY: 0,
    ghostX: 0,
    ghostY: 0,
  });
  const [proposedMove, setProposedMove] = useState<ProposedMove | null>(null);
  const undoStack = useRef<UndoEntry[]>([]);

  const startDrag = useCallback((block: Block, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.target as HTMLElement).closest('[data-block-id]')?.getBoundingClientRect();
    if (!rect) return;
    setDrag({
      isDragging: true,
      block,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      ghostX: rect.left,
      ghostY: rect.top,
    });
  }, []);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!drag.isDragging) return;
      setDrag((d) => ({
        ...d,
        ghostX: e.clientX - d.offsetX,
        ghostY: e.clientY - d.offsetY,
      }));
    },
    [drag.isDragging],
  );

  const endDrag = useCallback(
    (containerRect: DOMRect | null) => {
      if (!drag.isDragging || !drag.block || !containerRect) {
        setDrag((d) => ({ ...d, isDragging: false, block: null }));
        return;
      }

      const block = drag.block;
      // Calculate target machine from Y position
      const relY = drag.ghostY + drag.offsetY - containerRect.top;
      const machineIdx = Math.floor(relY / rowHeight);
      const targetMachine = machines[Math.max(0, Math.min(machineIdx, machines.length - 1))];

      // Calculate target time from X position
      const leftPanelWidth = 100; // matches GanttChart left panel
      const relX = drag.ghostX + drag.offsetX - containerRect.left - leftPanelWidth;
      const minOffset = relX / ppm;
      const toStartMin = Math.round(S0 + Math.max(0, Math.min(minOffset, RANGE)));

      const isFrozen = block.freezeStatus === 'frozen';

      // Only propose if position actually changed
      if (targetMachine.id !== block.machineId || Math.abs(toStartMin - block.startMin) > 5) {
        setProposedMove({
          block,
          toMachineId: targetMachine.id,
          toStartMin,
          isFrozen,
        });
      }

      setDrag((d) => ({ ...d, isDragging: false, block: null }));
    },
    [drag, machines, rowHeight, ppm],
  );

  const clearProposal = useCallback(() => setProposedMove(null), []);

  const pushUndo = useCallback((desc: string) => {
    undoStack.current.push({ description: desc, timestamp: Date.now() });
    if (undoStack.current.length > MAX_UNDO) {
      undoStack.current = undoStack.current.slice(-MAX_UNDO);
    }
  }, []);

  const popUndo = useCallback((): UndoEntry | null => {
    return undoStack.current.pop() ?? null;
  }, []);

  // Global mousemove/mouseup listeners during drag
  useEffect(() => {
    if (!drag.isDragging) return;
    const handleUp = () => endDrag(null);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [drag.isDragging, onMouseMove, endDrag]);

  return {
    drag,
    proposedMove,
    startDrag,
    endDrag,
    clearProposal,
    pushUndo,
    popUndo,
    undoStackSize: undoStack.current.length,
  };
}
