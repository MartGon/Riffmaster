import { gradeShapes, type Mark } from '../practice/grades'

/** The shape that marks a result in the tab, as a key beside its count or name. */
export function Shape({ mark }: { mark: Mark }) {
  return (
    <svg
      className={`mark-key mark-${mark}`}
      viewBox="0 0 10 10"
      width="11"
      height="11"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: gradeShapes[mark] }}
    />
  )
}
