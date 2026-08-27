export function setupDragAndDrop(element, { onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, getData }) {
  element.addEventListener("dragstart", (e) => {
    element.classList.add("dragging");
    element.setAttribute("aria-grabbed", "true");
    e.dataTransfer.effectAllowed = "move";
    if (getData) e.dataTransfer.setData("text/plain", getData(element));
    if (onDragStart) onDragStart(element, e);
  });

  element.addEventListener("dragend", () => {
    element.classList.remove("dragging");
    element.setAttribute("aria-grabbed", "false");
    if (onDragEnd) onDragEnd(element);
  });

  element.addEventListener("dragover", (e) => {
    e.preventDefault();
    element.classList.add("drag-over");
    e.dataTransfer.dropEffect = "move";
    if (onDragOver) onDragOver(element, e);
  });

  element.addEventListener("dragleave", () => {
    element.classList.remove("drag-over");
    if (onDragLeave) onDragLeave(element);
  });

  element.addEventListener("drop", (e) => {
    e.preventDefault();
    element.classList.remove("drag-over");
    if (onDrop) onDrop(element, e);
  });
}
