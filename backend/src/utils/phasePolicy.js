// Mirrors the Phase enum in contracts/src/Election3.sol:
//   0 Created, 1 Registration, 2 Voting, 3 Ended
export const PHASE = Object.freeze({
  CREATED: 0,
  REGISTRATION: 1,
  VOTING: 2,
  ENDED: 3,
});

/**
 * Candidate media is frozen once the ballot is open, mirroring the contract's
 * existing "Root frozen during voting" rule for Merkle roots (Election3.sol:124).
 * Without it a candidate could swap their photo mid-vote, and appearance is a
 * real influence on how people vote.
 *
 * Voter profile photos are deliberately NOT covered: they carry no
 * election-integrity weight, so freezing them would be user-hostile.
 */
export function isCandidatePhotoLocked(phase) {
  return Number(phase) >= PHASE.VOTING;
}