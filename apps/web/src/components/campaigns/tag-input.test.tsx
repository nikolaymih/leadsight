import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { TagInput } from "./tag-input";

function Harness({ onSubmit }: { onSubmit: (tags: string[]) => void }) {
  const [tags, setTags] = useState<string[]>([]);
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
});
