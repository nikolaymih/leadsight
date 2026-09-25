import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { splitTags, TagInput } from "./tag-input";

function Harness({ onSubmit, initial = [] }: { onSubmit: (tags: string[]) => void; initial?: string[] }) {
  const [tags, setTags] = useState<string[]>(initial);
  // Mirrors react-hook-form: the submit handler reads the latest committed value.
  const latest = { current: tags };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(latest.current);
      }}
    >
      <TagInput
        id="tags"
        value={tags}
        onChange={(next) => {
          latest.current = next;
          setTags(next);
        }}
      />
    </form>
  );
}

describe("TagInput", () => {
  it("counts text still in the field when the form submits", () => {
    const submitted: string[][] = [];
    const { container } = render(<Harness onSubmit={(t) => submitted.push(t)} />);
    const input = container.querySelector("input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "looking for a cto" } });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(submitted).toEqual([["looking for a cto"]]);
  });

  it("Enter and comma add tags without submitting", () => {
    const submitted: string[][] = [];
    const { container, getByText } = render(<Harness onSubmit={(t) => submitted.push(t)} />);
    const input = container.querySelector("input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "need a cto, hire developers" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(getByText("need a cto")).toBeTruthy();
    expect(getByText("hire developers")).toBeTruthy();
    expect(submitted).toEqual([]);
  });

  it("a multi-line paste adds one tag per line, mixed with commas, dropping duplicates", () => {
    const submitted: string[][] = [];
    const { container } = render(<Harness onSubmit={(t) => submitted.push(t)} initial={["already here"]} />);
    const input = container.querySelector("input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "typed first" } });
    const text = "need a cto\r\nhire developers, build an mvp\n\nneed a cto\nalready here\n";
    const notCancelled = fireEvent.paste(input, { clipboardData: { getData: () => text } });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(notCancelled).toBe(false);
    expect(input.value).toBe("");
    expect(submitted).toEqual([
      ["already here", "typed first", "need a cto", "hire developers", "build an mvp"],
    ]);
  });

  it("a single-line paste is left to the browser to insert into the field", () => {
    const submitted: string[][] = [];
    const { container } = render(<Harness onSubmit={(t) => submitted.push(t)} />);
    const input = container.querySelector("input") as HTMLInputElement;

    const notCancelled = fireEvent.paste(input, {
      clipboardData: { getData: () => "need a cto, hire developers" },
    });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(notCancelled).toBe(true);
    expect(submitted).toEqual([[]]);
  });
});

describe("splitTags", () => {
  it("splits on newlines and commas, trims, drops empties and duplicates", () => {
    expect(splitTags(" a ,b\r\n\n c,, a\rb ")).toEqual(["a", "b", "c"]);
    expect(splitTags(" \n , ")).toEqual([]);
  });
});
