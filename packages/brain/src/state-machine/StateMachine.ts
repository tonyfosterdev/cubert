import { State, StateContext, SensorData, Action, ActionEvent } from './State';
import { EventEmitter } from 'events';

export class StateMachine extends EventEmitter {
  private states: Map<string, State> = new Map();
  private currentState: State | null = null;
  private context: StateContext;

  constructor() {
    super();
    this.context = {
      sensorData: {} as SensorData,
      memory: new Map(),
      lastEvent: null,
    };
  }

  addState(state: State): void {
    this.states.set(state.name, state);
  }

  setInitialState(stateName: string): void {
    const state = this.states.get(stateName);
    if (!state) throw new Error(`State '${stateName}' not found`);

    this.currentState = state;
    console.log(`Initial state: ${stateName}`);

    // Call onEnter for initial state
    if (this.currentState.onEnter) {
      const action = this.currentState.onEnter(this.context);
      if (action) {
        this.emit('action', action);
      }
    }
  }

  getCurrentState(): string {
    return this.currentState?.name || 'NONE';
  }

  update(sensorData: SensorData): Action[] {
    if (!this.currentState) return [];

    this.context.sensorData = sensorData;
    this.context.lastEvent = null;
    const actions: Action[] = [];

    const { action, nextState } = this.currentState.onUpdate(this.context);

    if (action) actions.push(action);

    if (nextState && nextState !== this.currentState.name) {
      this.performTransition(nextState, actions);
    }

    return actions;
  }

  handleEvent(event: ActionEvent): Action[] {
    if (!this.currentState) return [];

    this.context.lastEvent = event;

    // If state has an event handler, use it
    if (this.currentState.onEvent) {
      const { action, nextState } = this.currentState.onEvent(this.context, event);
      const actions: Action[] = [];

      if (action) actions.push(action);

      if (nextState && nextState !== this.currentState.name) {
        this.performTransition(nextState, actions);
      }

      return actions;
    }

    return [];
  }

  private performTransition(nextStateName: string, actions: Action[]): void {
    const newState = this.states.get(nextStateName);
    if (newState) {
      console.log(`[${new Date().toISOString()}] State transition: ${this.currentState!.name} -> ${nextStateName}`);

      if (this.currentState!.onExit) {
        this.currentState!.onExit(this.context);
      }

      this.currentState = newState;

      if (this.currentState.onEnter) {
        const enterAction = this.currentState.onEnter(this.context);
        if (enterAction) actions.push(enterAction);
      }

      this.emit('stateChange', nextStateName);
    }
  }

  reset(): void {
    this.context.memory.clear();
    this.currentState = null;
  }

  resetToSafeState(): void {
    // Clear all pending action IDs
    this.context.memory.clear();

    // Transition to searching state
    const searchState = this.states.get('SEARCHING_GOLD');
    if (searchState) {
      if (this.currentState?.onExit) {
        this.currentState.onExit(this.context);
      }
      this.currentState = searchState;
      console.log('[RESET] State machine reset to SEARCHING_GOLD');
      this.emit('stateChange', 'SEARCHING_GOLD');
    }
  }
}
