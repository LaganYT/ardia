import { nativeModule, type ControlApprovals, type ControlPeerAnswer, type ControlPeerAsk, type ControlPeerOutcome, type ControlRequest, type ControlSocketStatus } from "@ardia/shell";

export type { ControlApproval, ControlApprovals, ControlPeerAnswer, ControlPeerAsk, ControlPeerOutcome, ControlRequest, ControlSocketStatus } from "@ardia/shell";

let bound: ReturnType<typeof nativeModule<"ArdiaAutomation">> | null = null;
const Automation = () => (bound ??= nativeModule("ArdiaAutomation"));

export const startControlSocket = () => Automation().start();
export const stopControlSocket = () => Automation().stop();
export const replyOnControlSocket = (connection: number, line: string, ticket = 0) => Automation().reply(connection, line, ticket);
export const broadcastOnControlSocket = (connections: number[], line: string) => Automation().broadcast(connections, line);
export const onControlRequest = (listener: (request: ControlRequest) => void) => Automation().addListener("onRequest", listener);
export const onControlClose = (listener: (e: { connection: number }) => void) => Automation().addListener("onClose", listener);
export const onControlWritten = (listener: (e: { tickets: number[] }) => void) => Automation().addListener("onWritten", listener);
export const onControlPeerAsk = (listener: (ask: ControlPeerAsk) => void) => Automation().addListener("onPeerAsk", listener);
export const onControlPeerAskEnded = (listener: (e: { ask: number; outcome: ControlPeerOutcome }) => void) => Automation().addListener("onPeerAskEnded", listener);
export const answerControlPeer = async (ask: number, outcome: ControlPeerAnswer) => (await Automation().answerPeer?.(ask, outcome)) ?? false;
export const controlApprovals = async (): Promise<ControlApprovals> => (await Automation().approvals?.()) ?? { approvals: [] };
export const revokeControlApproval = async (key: string) => (await Automation().revokeApproval?.(key)) ?? false;
