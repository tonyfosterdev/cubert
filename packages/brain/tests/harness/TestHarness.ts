import { StateMachine } from '../../src/state-machine/StateMachine';
import { SensorData, Action, ActionEvent } from '../../src/state-machine/State';

/**
 * TestHarness for synchronously testing the StateMachine without gRPC.
 */
export class TestHarness {
  public stateMachine: StateMachine;
  public emittedActions: Action[] = [];
  public stateHistory: string[] = [];

  constructor(stateMachine: StateMachine) {
    this.stateMachine = stateMachine;
    this.stateMachine.on('stateChange', (state: string) => {
      this.stateHistory.push(state);
    });
    this.stateMachine.on('action', (action: Action) => {
      this.emittedActions.push(action);
    });
  }

  sendSensorData(sensorData: SensorData): Action[] {
    const actions = this.stateMachine.update(sensorData);
    this.emittedActions.push(...actions);
    return actions;
  }

  completeAction(actionId: string, result: 'SUCCESS' | 'FAILED', errorMessage?: string): Action[] {
    const event: ActionEvent = {
      actionId,
      result: `ACTION_RESULT_${result}`,
      eventType: 'ACTION_EVENT_COMPLETED',
      errorMessage,
    };
    const actions = this.stateMachine.handleEvent(event);
    this.emittedActions.push(...actions);
    return actions;
  }

  sendConnectEvent(sensorData: SensorData): Action[] {
    this.stateMachine.resetToSafeState();
    return this.sendSensorData(sensorData);
  }

  getCurrentState(): string {
    return this.stateMachine.getCurrentState();
  }

  getLastAction(): Action | undefined {
    return this.emittedActions[this.emittedActions.length - 1];
  }

  getActionsByType(type: string): Action[] {
    return this.emittedActions.filter((a) => a.type === type);
  }

  clearHistory(): void {
    this.emittedActions = [];
    this.stateHistory = [];
  }

  getMemory(): Map<string, any> {
    return (this.stateMachine as any).context.memory;
  }
}
