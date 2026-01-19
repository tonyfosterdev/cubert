import { State, StateContext, SensorData, Action } from './State';
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
    const actions: Action[] = [];

    const { action, nextState } = this.currentState.onUpdate(this.context);

    if (action) actions.push(action);

    if (nextState && nextState !== this.currentState.name) {
      const newState = this.states.get(nextState);
      if (newState) {
        console.log(`State transition: ${this.currentState.name} -> ${nextState}`);

        if (this.currentState.onExit) {
          this.currentState.onExit(this.context);
        }

        this.currentState = newState;

        if (this.currentState.onEnter) {
          const enterAction = this.currentState.onEnter(this.context);
          if (enterAction) actions.push(enterAction);
        }

        this.emit('stateChange', nextState);
      }
    }

    return actions;
  }

  reset(): void {
    this.context.memory.clear();
    this.currentState = null;
  }
}
