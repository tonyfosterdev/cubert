import { StateMachine } from '../../StateMachine';
import {
  IdleState,
  SearchingGoldState,
  MovingToGoldState,
  MiningState,
  SearchingChestState,
  MovingToChestState,
  DepositingState,
} from './states';

export function createGoldMiningStateMachine(): StateMachine {
  const stateMachine = new StateMachine();

  // Add all states
  stateMachine.addState(IdleState);
  stateMachine.addState(SearchingGoldState);
  stateMachine.addState(MovingToGoldState);
  stateMachine.addState(MiningState);
  stateMachine.addState(SearchingChestState);
  stateMachine.addState(MovingToChestState);
  stateMachine.addState(DepositingState);

  // Set initial state
  stateMachine.setInitialState('IDLE');

  return stateMachine;
}
