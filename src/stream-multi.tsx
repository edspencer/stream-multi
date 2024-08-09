import { ReactNode } from "react";
import { Message } from "./Message";

import { streamText, CoreTool, StreamTextResult } from "ai";
import { createStreamableUI, createStreamableValue, StreamableValue } from "ai/rsc";

type TextSegment = {
  type: "text";
  text: string;
  stream: any;
};

type ToolCallSegment = {
  type: "tool-call";
  toolCall: {
    toolCallId: string;
    toolName: string;
    args: any;
  };
};

export type Segment = TextSegment | ToolCallSegment;

type Streamable = ReactNode | Promise<ReactNode>;

type Renderer<T extends Array<any>> = (
  ...args: T
) => Streamable | Generator<Streamable, Streamable, void> | AsyncGenerator<Streamable, Streamable, void>;

// Infer the parameters of the streamText function
type StreamTextParams = Parameters<typeof streamText>;

type TextComponentParams = {
  content: StreamableValue<string>;
};

// Extend the inferred parameters with an additional onSegment callback
export type StreamMultiParams<TOOLS extends Record<string, CoreTool>> = StreamTextParams[0] & {
  onSegment?: (segment: Segment) => void;
  initial?: ReactNode;
  textComponent?: (params: TextComponentParams) => ReactNode;
};

//this isn't exported by Vercel AI SDK unfortunately, so we have to inline it here
type StreamableUIWrapper = {
  /**
   * The value of the streamable UI. This can be returned from a Server Action and received by the client.
   */
  readonly value: React.ReactNode;

  /**
   * This method updates the current UI node. It takes a new UI node and replaces the old one.
   */
  update(value: React.ReactNode): StreamableUIWrapper;

  /**
   * This method is used to append a new UI node to the end of the old one.
   * Once appended a new UI node, the previous UI node cannot be updated anymore.
   *
   * @example
   * ```jsx
   * const ui = createStreamableUI(<div>hello</div>)
   * ui.append(<div>world</div>)
   *
   * // The UI node will be:
   * // <>
   * //   <div>hello</div>
   * //   <div>world</div>
   * // </>
   * ```
   */
  append(value: React.ReactNode): StreamableUIWrapper;

  /**
   * This method is used to signal that there is an error in the UI stream.
   * It will be thrown on the client side and caught by the nearest error boundary component.
   */
  error(error: any): StreamableUIWrapper;

  /**
   * This method marks the UI node as finalized. You can either call it without any parameters or with a new UI node as the final state.
   * Once called, the UI node cannot be updated or appended anymore.
   *
   * This method is always **required** to be called, otherwise the response will be stuck in a loading state.
   */
  done(...args: [React.ReactNode] | []): StreamableUIWrapper;
};

type StreamMultiResult<TOOLS extends Record<string, CoreTool>> = StreamTextResult<TOOLS> & {
  ui: StreamableUIWrapper;
};

// type ToolWithGenerate<TArgs, TResult> = CoreTool<TArgs, TResult> & {
//   generate: (args: TArgs) => TResult | Promise<TResult>;
// };

/**
 * This is a wrapper around the Vercel AI SDK's streamText function that allows for multiple tools to be called and rendered in a single stream,
 * along with text responses. When LLMs capable of tool calling (such as OpenAI's GPT 4) are used as the model, this function can be used to
 * their responses can include a mixture of text and tool calls. Usually the text precedes the tool call(s), but not always.
 *
 * streamMulti() the concept of "segments" to streamText - essentially whenever the LLM transitions from sending text responses to sending
 * tool call responses, a new segment is created. Each segment can be rendered in the UI as it is received, and the onSegment callback can be used
 * to perform actions on each segment as it is received. Usually this is useful to update the AI State with the tool calls that are received.
 *
 * Under the covers, this just creates a new createStreamableUI instance, which is immediately returned and will be appended with the text and tool
 * segments you specify, based on the LLM response. So in addition to the normal streamText() response object, you also get a UI object that you can
 * use to render the AI's responses in the UI.
 *
 * The tools definition takes a leaf out of the streamUI() function, in that it accepts a `generate` function that will be called with the tool's
 * arguments and a UI object that can be used to render the tool's response.
 */
// @ts-ignore
export async function streamMulti<TOOLS extends Record<string, CoreTool>>(
  params: StreamMultiParams<TOOLS>
): Promise<StreamMultiResult<TOOLS>> {
  const { tools, initial, onSegment } = params;
  const result = await streamText(params);

  const [stream, forkedStream] = result.fullStream.tee();

  const ui = createStreamableUI(initial);

  //the initial UI should be removed as soon as we receive the first segment
  let initialRemoved = false;

  function appendUI(component: ReactNode) {
    if (initialRemoved) {
      return ui.append(component);
    } else {
      initialRemoved = true;
      ui.update(component);
    }
  }

  const segments: Segment[] = [];

  function addSegment(segment: Segment) {
    markLastSegmentDone();

    segments.push(segment);

    return segment;
  }

  //the React component that is used to show text responses. Can be customized or use Message as default
  const TextComponent = params.textComponent || Message;

  //called whenever a text chunk is received. Will create a new segment if we're not already in a text segment
  function streamTextSegment(value: any) {
    const latestSegment = segments[segments.length - 1];

    if (latestSegment && latestSegment.type === "text") {
      latestSegment.text += value.textDelta;
      latestSegment.stream.append(value.textDelta);

      return latestSegment;
    } else {
      //first segment, or first text after a tool call. Create a segment and stream for it
      const textStream = createStreamableValue(value.textDelta);
      appendUI(<TextComponent content={textStream.value} />);

      return addSegment({
        type: "text",
        text: value.textDelta,
        stream: textStream,
      });
    }
  }

  //a tool was called, render and return it
  function streamToolSegment(value: any) {
    const toolUi = createStreamableUI();
    appendUI(<div className="tool mt-4">{toolUi.value}</div>);

    // toolUi.done(<div>{JSON.stringify(value, null, 4)}</div>);

    //find tool
    const tool = tools?.[value.toolName];

    if (tool) {
      // @ts-expect-error
      handleRender([value.args], tool.generate, toolUi, true);
    } else {
      toolUi.done(<div>Tool not found</div>);
    }

    return addSegment({
      type: "tool-call",
      toolCall: {
        toolCallId: value.toolCallId,
        toolName: value.toolName,
        args: value.args,
      },
    });
  }

  function markLastSegmentDone() {
    const latestSegment = segments[segments.length - 1];

    if (latestSegment) {
      if (latestSegment.type === "text") {
        latestSegment.stream.done();
      }

      if (onSegment) {
        onSegment(latestSegment);
      }
    }
  }

  let finished: Promise<void> | undefined;

  //this is a total copy/paste from @lgrammel's handleRender function in ai/rsc
  //allows for async rendering of components, including async generators. Awesome ideas.
  async function handleRender(
    args: [payload: any] | [payload: any, options: any],
    renderer: undefined | Renderer<any>,
    res: ReturnType<typeof createStreamableUI>,
    lastCall = false
  ) {
    if (!renderer) return;

    const resolvable = createResolvablePromise<void>();

    if (finished) {
      finished = finished.then(() => resolvable.promise);
    } else {
      finished = resolvable.promise;
    }

    const value = renderer(...args);
    if (
      value instanceof Promise ||
      (value && typeof value === "object" && "then" in value && typeof value.then === "function")
    ) {
      const node = await (value as Promise<React.ReactNode>);

      if (lastCall) {
        res.done(node);
      } else {
        res.update(node);
      }

      resolvable.resolve(void 0);
    } else if (value && typeof value === "object" && Symbol.asyncIterator in value) {
      const it = value as AsyncGenerator<React.ReactNode, React.ReactNode, void>;
      while (true) {
        const { done, value } = await it.next();
        if (lastCall && done) {
          res.done(value);
        } else {
          res.update(value);
        }
        if (done) break;
      }
      resolvable.resolve(void 0);
    } else if (value && typeof value === "object" && Symbol.iterator in value) {
      const it = value as Generator<React.ReactNode, React.ReactNode, void>;
      while (true) {
        const { done, value } = it.next();
        if (lastCall && done) {
          res.done(value);
        } else {
          res.update(value);
        }
        if (done) break;
      }
      resolvable.resolve(void 0);
    } else {
      if (lastCall) {
        res.done(value);
      } else {
        res.update(value);
      }
      resolvable.resolve(void 0);
    }
  }

  //everything above this is just setup. This is where the actual work happens.
  //We consume the stream and split into segments, then render each segment as it comes in
  (async () => {
    try {
      // Consume the forked stream asynchronously.
      let content = "";

      const reader = forkedStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          ui.done();
          break;
        }

        switch (value.type) {
          case "text-delta": {
            streamTextSegment(value);
            content += value.textDelta;
            break;
          }

          //not clear what a tool delta really means - often we can't call a function until we receive the full signature
          case "tool-call-delta": {
            break;
          }

          case "tool-call": {
            streamToolSegment(value);

            break;
          }

          case "error": {
            throw value.error;
          }

          case "finish": {
            markLastSegmentDone();
          }
        }
      }

      // Await the finished promise to ensure all rendering tasks are complete
      if (finished) {
        await finished;
      }
    } catch (error) {
      ui.error(error);
    }
  })();

  return { ...(result as StreamTextResult<TOOLS>), ui };
}

//copy/pasted from ai/rsc
export function createResolvablePromise<T = any>() {
  let resolve: (value: T) => void, reject: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    resolve: resolve!,
    reject: reject!,
  };
}
