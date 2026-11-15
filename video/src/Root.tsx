import React from "react";
import { Composition } from "remotion";
import { Demo, FPS, TOTAL_FRAMES, Thumbnail } from "./Demo";

export const Root: React.FC = () => (
  <>
  <Composition id="Thumbnail" component={Thumbnail} durationInFrames={1} fps={FPS} width={1920} height={1080} />
  <Composition id="MezoChatDemo" component={Demo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
  </>
);
